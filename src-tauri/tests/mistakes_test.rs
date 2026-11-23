//! 错题本：错因归一、订正状态、列表顺序、导出导入往返、挂知识点。
//!
//! 错题本是给学生自己记错题用的，MVP 只保四件事：
//! 1. 错因是闭合集合，未知值归到「其他」，不会出现奇怪的自由文本。
//! 2. 科目是开放字符串，但空值归到「其他」。
//! 3. 未订正的错题排在前面——复习时先看没搞懂的。
//! 4. 导出的备份要能原样导回来。
//!
//! 另外，错题可以挂到知识图谱的知识点上：这样同一个知识点 id 在任务与错题本
//! 里指的是同一件事，两边不是两张各画各的地图。

mod common;

use rusqlite::Connection;
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use timequest_lib::{
    create_mistake_impl, delete_mistake_impl, export_json_impl, import_json_impl,
    list_mistakes_impl, list_topic_mistakes_impl, normalize_reason, normalize_reason_in,
    normalize_subject, reason_whitelist, set_list_setting_impl, update_mistake_impl,
    CreateMistakePayload, Mistake, TopicMistake, TopicMistakes, UpdateMistakePayload,
    REASON_WHITELIST, TRACK_MISTAKE_REASONS_SETTING_KEY,
};

/// 建一条错题的请求体。
///
/// 参数平铺，写起来比结构体字面量短。顺序错了编译器抓不到，所以字段名在
/// 这里看得见——图谱那三个本来就必须是一组的。
fn new_mistake(
    subject: &str,
    title: &str,
    reason: &str,
    correct_note: &str,
    graph_topic_id: Option<&str>,
    graph_subject: Option<&str>,
    graph_topic_name: Option<&str>,
) -> CreateMistakePayload {
    CreateMistakePayload {
        subject: subject.to_string(),
        title: title.to_string(),
        reason: reason.to_string(),
        correct_note: correct_note.to_string(),
        graph_topic_id: graph_topic_id.map(str::to_string),
        graph_subject: graph_subject.map(str::to_string),
        graph_topic_name: graph_topic_name.map(str::to_string),
    }
}

/// 假插件 id。跟真插件不同名，就不会读到内置那份数学数据。
const PLUGIN_ID: &str = "test-graph";

/// 图谱里的两个点。名字要和错题里存的显示名对得上。
const TOPICS: &str = r#"{"topics":[
    {"id":"t_advanced","name":"三角函数"},
    {"id":"t_basic","name":"函数"}
]}"#;

const DEPENDENCIES: &str = r#"{"dependencies":[
    {"topicId":"t_advanced","prerequisiteId":"t_basic","strength":"hard","reason":"先会函数"}
]}"#;

/// 造一个假插件目录，里面放一份可控的图谱。
fn fake_plugin_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "timequest-mistakes-graph-{}",
        uuid::Uuid::new_v4()
    ));
    let resources = dir.join(PLUGIN_ID).join("resources");
    std::fs::create_dir_all(&resources).expect("create resources dir");
    std::fs::write(resources.join("topics.math.json"), TOPICS).expect("write topics");
    std::fs::write(resources.join("dependencies.math.json"), DEPENDENCIES).expect("write deps");
    dir
}

/// 往库里塞一条错题，顺带挂上知识点。
async fn insert_graph_mistake(
    pool: &sqlx::SqlitePool,
    title: &str,
    reason: &str,
    mastered: i64,
    topic_id: &str,
    topic_name: &str,
) {
    sqlx::query(
        "INSERT INTO mistakes
           (subject, title, reason, correct_note, is_mastered, graph_topic_id, graph_subject, graph_topic_name)
         VALUES ('数学', ?1, ?2, '', ?3, ?4, 'math', ?5)",
    )
    .bind(title)
    .bind(reason)
    .bind(mastered)
    .bind(topic_id)
    .bind(topic_name)
    .execute(pool)
    .await
    .expect("insert mistake");
}

async fn open_rusqlite_migrated() -> (PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("timequest-mistakes-{}.db", uuid::Uuid::new_v4()));
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    let path_str = path.to_string_lossy().replace('\\', "/");
    let url = format!("sqlite:{path_str}?mode=rwc");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect temp sqlite");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("pragma");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("migrate");
    pool.close().await;

    let conn = Connection::open(&path).expect("rusqlite open");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("pragma foreign_keys");
    (path, conn)
}

#[test]
fn frontend_reason_list_matches_backend_whitelist() {
    // 护栏：前端下拉框（src/lib/fallbacks.ts 的 FALLBACK_MISTAKE_REASONS）必须与后端白名单一致，
    // 否则用户会选到后端静默改成「其他」的错因。
    //
    // 前端白名单是**缺省值**：赛道包可以在 app_settings 里覆盖它（前后端读同一份），
    // 但缺省的那一份必须和后端内置表逐项相等。
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("lib")
        .join("fallbacks.ts");
    let source = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let start = source
        .find("FALLBACK_MISTAKE_REASONS = [")
        .unwrap_or_else(|| {
            panic!(
                "FALLBACK_MISTAKE_REASONS block not found in {}",
                path.display()
            )
        });
    let end = source[start..]
        .find("] as const;")
        .unwrap_or_else(|| {
            panic!(
                "FALLBACK_MISTAKE_REASONS block is not closed in {}",
                path.display()
            )
        })
        + start;
    let frontend: Vec<&str> = source[start..end]
        .lines()
        .filter_map(|line| line.trim().strip_prefix('"'))
        .filter_map(|rest| rest.split('"').next())
        .collect();
    assert_eq!(
        frontend,
        REASON_WHITELIST.to_vec(),
        "frontend FALLBACK_MISTAKE_REASONS must match Rust REASON_WHITELIST"
    );
}

/// 赛道包可以在 app_settings 里覆盖错因白名单（前后端读同一份）。
///
/// 覆盖后：清单里的错因原样保留，清单外的错因归到「其他」而不是自由文本。
#[tokio::test]
async fn configured_reason_whitelist_replaces_the_builtin_one() {
    let (path, conn) = open_rusqlite_migrated().await;

    let configured = vec![
        "概念不清".to_string(),
        "背不下来".to_string(),
        "其他".to_string(),
    ];
    set_list_setting_impl(&conn, TRACK_MISTAKE_REASONS_SETTING_KEY, &configured)
        .expect("write whitelist");

    assert_eq!(reason_whitelist(&conn), configured);

    let kept = create_mistake_impl(
        &conn,
        new_mistake("英语", "单词背不下来", "背不下来", "", None, None, None),
    )
    .expect("create");
    assert_eq!(kept.reason, "背不下来");

    // 内置表里有、赛道表里没有的错因：归到「其他」，不落成自由文本。
    let dropped = create_mistake_impl(
        &conn,
        new_mistake("英语", "审题失误", "审题失误", "", None, None, None),
    )
    .expect("create");
    assert_eq!(dropped.reason, "其他");

    let _ = std::fs::remove_file(&path);
}

#[test]
fn normalize_reason_maps_unknown_to_other() {
    assert_eq!(normalize_reason("概念不清"), "概念不清");
    assert_eq!(normalize_reason("  审题失误  "), "审题失误");
    assert_eq!(normalize_reason("瞎写的"), "其他");
    assert_eq!(normalize_reason(""), "其他");
}

/// 归一错因时用哪张白名单，由调用方说了算（赛道包覆盖后的那张）。
#[test]
fn normalize_reason_in_uses_the_given_whitelist() {
    let whitelist = vec!["背不下来".to_string(), "其他".to_string()];
    assert_eq!(normalize_reason_in(&whitelist, "背不下来"), "背不下来");
    assert_eq!(normalize_reason_in(&whitelist, " 背不下来 "), "背不下来");
    // 清单外的错因归到「其他」，不落成自由文本。
    assert_eq!(normalize_reason_in(&whitelist, "审题失误"), "其他");

    // 白名单里没有「其他」就退到第一项，至少不是空的。
    let no_other = vec!["背不下来".to_string()];
    assert_eq!(normalize_reason_in(&no_other, "瞎写的"), "背不下来");

    // 空白名单：兜底「其他」。
    assert_eq!(normalize_reason_in(&[], "瞎写的"), "其他");
}

#[test]
fn normalize_subject_trims_and_falls_back_to_other() {
    assert_eq!(normalize_subject("  物理 "), "物理");
    assert_eq!(normalize_subject("   "), "其他");
    assert_eq!(normalize_subject(""), "其他");
}

#[tokio::test]
async fn create_mistake_stores_normalized_reason_and_subject() {
    let (path, conn) = open_rusqlite_migrated().await;

    let created = create_mistake_impl(
        &conn,
        new_mistake(
            "  物理  ",
            "牛顿第二定律应用",
            "瞎写的",
            "先选正方向再列 F=ma",
            None,
            None,
            None,
        ),
    )
    .expect("create mistake");

    assert_eq!(created.subject, "物理");
    assert_eq!(created.reason, "其他");
    assert_eq!(created.title, "牛顿第二定律应用");
    assert_eq!(created.correct_note, "先选正方向再列 F=ma");
    assert_eq!(created.is_mastered, 0);
    assert_eq!(created.graph_topic_id, None);
    assert_eq!(created.graph_subject, None);
    assert_eq!(created.graph_topic_name, None);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn list_mistakes_puts_unmastered_first() {
    let (path, conn) = open_rusqlite_migrated().await;

    let mastered = create_mistake_impl(
        &conn,
        new_mistake("数学", "已订正的题", "计算失误", "", None, None, None),
    )
    .expect("create mastered");
    let pending = create_mistake_impl(
        &conn,
        new_mistake("化学", "还没订正的题", "概念不清", "", None, None, None),
    )
    .expect("create pending");

    update_mistake_impl(
        &conn,
        mastered.id,
        UpdateMistakePayload {
            is_mastered: Some(1),
            ..Default::default()
        },
    )
    .expect("mark mastered");

    let rows = list_mistakes_impl(&conn).expect("list");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].id, pending.id);
    assert_eq!(rows[0].is_mastered, 0);
    assert_eq!(rows[1].id, mastered.id);
    assert_eq!(rows[1].is_mastered, 1);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn update_mistake_only_touches_given_fields() {
    let (path, conn) = open_rusqlite_migrated().await;

    let created = create_mistake_impl(
        &conn,
        new_mistake("物理", "原题", "公式记错", "原思路", None, None, None),
    )
    .expect("create");

    let updated = update_mistake_impl(
        &conn,
        created.id,
        UpdateMistakePayload {
            title: Some("改过的题".into()),
            ..Default::default()
        },
    )
    .expect("update");

    assert_eq!(updated.title, "改过的题");
    assert_eq!(updated.subject, "物理");
    assert_eq!(updated.reason, "公式记错");
    assert_eq!(updated.correct_note, "原思路");
    assert_eq!(updated.is_mastered, 0);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn delete_mistake_removes_the_row() {
    let (path, conn) = open_rusqlite_migrated().await;

    let created = create_mistake_impl(
        &conn,
        new_mistake("生物", "题", "其他", "", None, None, None),
    )
    .expect("create");
    delete_mistake_impl(&conn, created.id).expect("delete");

    assert!(list_mistakes_impl(&conn).expect("list").is_empty());

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn mistakes_survive_export_import_round_trip() {
    let (path, conn) = open_rusqlite_migrated().await;

    let created = create_mistake_impl(
        &conn,
        new_mistake("英语", "定语从句", "审题失误", "先找先行词", None, None, None),
    )
    .expect("create");
    update_mistake_impl(
        &conn,
        created.id,
        UpdateMistakePayload {
            is_mastered: Some(1),
            ..Default::default()
        },
    )
    .expect("mark mastered");

    let json = export_json_impl(&conn).expect("export");
    assert!(json.contains("定语从句"), "export must contain the mistake");

    import_json_impl(&conn, &json).expect("import");

    let rows = list_mistakes_impl(&conn).expect("list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].subject, "英语");
    assert_eq!(rows[0].reason, "审题失误");
    assert_eq!(rows[0].correct_note, "先找先行词");
    assert_eq!(rows[0].is_mastered, 1);

    let _ = std::fs::remove_file(&path);
}

/// 错题挂上知识点后，id / 学科 / 名字三个字段一起入库。
#[tokio::test]
async fn mistake_carries_the_graph_topic_id() {
    let (path, conn) = open_rusqlite_migrated().await;

    let created = create_mistake_impl(
        &conn,
        new_mistake(
            "数学",
            "诱导公式推导",
            "概念不清",
            "从 sin(a+b) 展开",
            Some("cnm_001"),
            Some("math"),
            Some("三角函数"),
        ),
    )
    .expect("create");

    assert_eq!(created.graph_topic_id.as_deref(), Some("cnm_001"));
    assert_eq!(created.graph_subject.as_deref(), Some("math"));
    assert_eq!(created.graph_topic_name.as_deref(), Some("三角函数"));

    // 列表里也带着，图谱那边才能按 id 查回来。
    let rows = list_mistakes_impl(&conn).expect("list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].graph_topic_id.as_deref(), Some("cnm_001"));
    assert_eq!(rows[0].graph_topic_name.as_deref(), Some("三角函数"));

    let _ = std::fs::remove_file(&path);
}

/// 空白的知识点 id 当作没挂，不给错题安上一个空的知识点。
#[tokio::test]
async fn blank_graph_topic_id_is_treated_as_not_attached() {
    let (path, conn) = open_rusqlite_migrated().await;

    let created = create_mistake_impl(
        &conn,
        new_mistake(
            "数学",
            "题",
            "其他",
            "",
            Some("   "),
            Some("math"),
            Some("三角函数"),
        ),
    )
    .expect("create");

    assert_eq!(created.graph_topic_id, None);

    let _ = std::fs::remove_file(&path);
}

/// 题目简述不能是空的：前端拦了一道，后端也要拦一道。
#[tokio::test]
async fn create_mistake_rejects_an_empty_title() {
    let (path, conn) = open_rusqlite_migrated().await;

    let err = create_mistake_impl(
        &conn,
        new_mistake("物理", "   ", "概念不清", "", None, None, None),
    )
    .expect_err("空题目应该被拒");

    assert!(err.contains("题目简述"), "错误要说清楚：{err}");

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM mistakes", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0, "被拒的错题不该入库");

    let _ = std::fs::remove_file(&path);
}

/// 换绑知识点是整组换：不能只换 id 却留着旧名字。
#[tokio::test]
async fn update_mistake_rebinds_the_knowledge_point_as_a_whole() {
    let (path, conn) = open_rusqlite_migrated().await;

        let created = create_mistake_impl(
        &conn,
        new_mistake(
            "数学",
            "诱导公式推导",
            "概念不清",
            "",
            Some("cnm_001"),
            Some("math"),
            Some("三角函数"),
        ),
    )
    .expect("create");

    // 只给了新的 id，没给名字：旧名字不能留着，否则错题会显示成另一个知识点。
    let rebound = update_mistake_impl(
        &conn,
        created.id,
        UpdateMistakePayload {
            graph_topic_id: Some("cnm_002".into()),
            ..Default::default()
        },
    )
    .expect("update");

    assert_eq!(rebound.graph_topic_id, Some("cnm_002".to_string()));
    assert_eq!(
        rebound.graph_topic_name, None,
        "旧名字不能挂在新 id 下面"
    );

    // 三个字段一起给，就整组换过去。
    let rebound = update_mistake_impl(
        &conn,
        created.id,
        UpdateMistakePayload {
            graph_topic_id: Some("cnm_002".into()),
            graph_subject: Some("math".into()),
            graph_topic_name: Some("相反数".into()),
            ..Default::default()
        },
    )
    .expect("update");

    assert_eq!(rebound.graph_topic_id, Some("cnm_002".to_string()));
    assert_eq!(rebound.graph_subject, Some("math".to_string()));
    assert_eq!(rebound.graph_topic_name, Some("相反数".to_string()));

    let _ = std::fs::remove_file(&path);
}

/// 解绑知识点：三个字段一起清，不留「没 id 却有名字」的孤儿。
#[tokio::test]
async fn update_mistake_with_a_blank_topic_id_detaches_everything() {
    let (path, conn) = open_rusqlite_migrated().await;

        let created = create_mistake_impl(
        &conn,
        new_mistake(
            "数学",
            "诱导公式推导",
            "概念不清",
            "",
            Some("cnm_001"),
            Some("math"),
            Some("三角函数"),
        ),
    )
    .expect("create");

    let detached = update_mistake_impl(
        &conn,
        created.id,
        UpdateMistakePayload {
            graph_topic_id: Some("".into()),
            ..Default::default()
        },
    )
    .expect("update");

    assert_eq!(detached.graph_topic_id, None);
    assert_eq!(detached.graph_subject, None);
    assert_eq!(detached.graph_topic_name, None);

    let _ = std::fs::remove_file(&path);
}

/// 挂了知识点的错题，导出再导入后挂载关系不丢。
#[tokio::test]
async fn graph_topics_survive_export_import_round_trip() {
    let (path, conn) = open_rusqlite_migrated().await;

    create_mistake_impl(
        &conn,
        new_mistake(
            "数学",
            "诱导公式推导",
            "概念不清",
            "",
            Some("cnm_001"),
            Some("math"),
            Some("三角函数"),
        ),
    )
    .expect("create");

    let json = export_json_impl(&conn).expect("export");
    assert!(
        json.contains("cnm_001"),
        "导出要带上知识点 id，否则备份一还原就断链：{json}"
    );

    import_json_impl(&conn, &json).expect("import");

    let rows = list_mistakes_impl(&conn).expect("list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].graph_topic_id.as_deref(), Some("cnm_001"));
    assert_eq!(rows[0].graph_subject.as_deref(), Some("math"));
    assert_eq!(rows[0].graph_topic_name.as_deref(), Some("三角函数"));

    let _ = std::fs::remove_file(&path);
}

/// 旧备份没有图谱字段，导入后当作没挂知识点，不报错。
#[tokio::test]
async fn old_backup_without_graph_fields_imports_as_null() {
    let (path, conn) = open_rusqlite_migrated().await;

    let json = r#"{
        "mistakes": [
            {"id": 1, "subject": "数学", "title": "老备份里的题", "reason": "概念不清",
             "correct_note": "", "is_mastered": 0,
             "created_at": "2026-11-01 10:00:00", "updated_at": "2026-11-01 10:00:00"}
        ],
        "user_stats": {"id": 1, "total_xp": 0, "current_level": 1, "current_streak": 0,
                       "longest_streak": 0, "last_done_date": null}
    }"#;

    import_json_impl(&conn, json).expect("import old backup");

    let rows = list_mistakes_impl(&conn).expect("list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].title, "老备份里的题");
    assert_eq!(rows[0].graph_topic_id, None);
    assert_eq!(rows[0].graph_subject, None);
    assert_eq!(rows[0].graph_topic_name, None);

    let _ = std::fs::remove_file(&path);
}

/// 备份里的图谱三列是空白串时，导入后按「没挂知识点」处理。
///
/// 导入路径必须跟新建路径走同一条归一。否则一份手改过的备份就能塞进一条
/// 挂着空名字的错题：错题本里看不出异常，图谱侧却多出一个空点。
#[tokio::test]
async fn import_normalizes_blank_graph_fields() {
    let (path, conn) = open_rusqlite_migrated().await;

    let json = r#"{
        "mistakes": [
            {"id": 1, "subject": "数学", "title": "空白图谱字段", "reason": "概念不清",
             "correct_note": "", "is_mastered": 0,
             "created_at": "2026-11-01 10:00:00", "updated_at": "2026-11-01 10:00:00",
             "graph_topic_id": "   ", "graph_subject": "  ", "graph_topic_name": "  "}
        ],
        "user_stats": {"id": 1, "total_xp": 0, "current_level": 1, "current_streak": 0,
                       "longest_streak": 0, "last_done_date": null}
    }"#;

    import_json_impl(&conn, json).expect("import");

    let rows = list_mistakes_impl(&conn).expect("list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].graph_topic_id, None);
    assert_eq!(rows[0].graph_subject, None);
    assert_eq!(rows[0].graph_topic_name, None);

    let _ = std::fs::remove_file(&path);
}

/// 按知识点查错题：只回这个点上的，未订正的排前面。
#[tokio::test]
async fn list_topic_mistakes_returns_the_mistakes_of_one_knowledge_point() {
    let pool = common::setup().await;
    let dir = fake_plugin_dir();

    insert_graph_mistake(&pool, "诱导公式推导", "概念不清", 0, "t_advanced", "三角函数").await;
    insert_graph_mistake(&pool, "求导忘记换元", "计算失误", 1, "t_advanced", "三角函数").await;
    insert_graph_mistake(&pool, "定义域写漏了", "审题失误", 0, "t_basic", "函数").await;
    // 没挂知识点的错题不进任何一个知识点。
    sqlx::query(
        "INSERT INTO mistakes (subject, title, reason, correct_note, is_mastered)
         VALUES ('数学', '随手记的题', '其他', '', 0)",
    )
    .execute(&pool)
    .await
    .expect("insert plain mistake");

    let found = list_topic_mistakes_impl(&pool, &dir, PLUGIN_ID, "math", "t_advanced")
        .await
        .expect("list topic mistakes");

    assert_eq!(found.topic_id, "t_advanced");
    assert_eq!(found.topic_name, "三角函数");
    assert_eq!(found.total, 2, "只回这个知识点上的：{found:?}");
    assert_eq!(found.pending, 1);
    assert_eq!(found.items.len(), 2);
    // 未订正的排前面。
    assert_eq!(found.items[0].is_mastered, 0);
    assert_eq!(found.items[0].title, "诱导公式推导");
    assert_eq!(found.items[1].is_mastered, 1);

    let _ = std::fs::remove_dir_all(&dir);
}

/// 学科包读不到时，错题照样给出来，只少一个知识点名。不能因为缺包把错题藏了。
#[tokio::test]
async fn missing_pack_still_returns_the_mistakes_of_one_knowledge_point() {
    let pool = common::setup().await;
    let dir = std::env::temp_dir().join(format!(
        "timequest-mistakes-graph-empty-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).expect("create empty dir");

    insert_graph_mistake(&pool, "诱导公式推导", "概念不清", 0, "t_advanced", "三角函数").await;

    let found = list_topic_mistakes_impl(&pool, &dir, PLUGIN_ID, "math", "t_advanced")
        .await
        .expect("读不到图谱也要返回，不能炸");

    assert_eq!(found.total, 1);
    assert_eq!(found.topic_name, "");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 前端类型和后端字段名必须对得上。
///
/// 前端 `src/types.ts` 里 `Mistake` / `TopicMistake` / `TopicMistakes` 都按
/// snake_case 写。后端哪天给其中一个挂上 `rename_all = "camelCase"`，前端读到的
/// 就全是 undefined，而且不报错——只表现为「已订正的错题看起来还是没订正」。
///
/// 前端的测试 mock 盖不住这个问题：mock 是前端自己写的，后端改了名，前端测试
/// 照样全绿。所以这里直接读前端的类型定义，跟后端实际序列化出来的键名比对。
#[test]
fn frontend_types_match_the_serialized_field_names() {
    let types_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/types.ts");
    let source = std::fs::read_to_string(&types_path).expect("read src/types.ts");

    let mistake = Mistake {
        id: 1,
        subject: "数学".to_string(),
        title: "求 f(x)".to_string(),
        reason: "概念不清".to_string(),
        correct_note: "先看定义域".to_string(),
        is_mastered: 0,
        graph_topic_id: Some("t_basic".to_string()),
        graph_subject: Some("math".to_string()),
        graph_topic_name: Some("函数".to_string()),
        created_at: "2026-11-19 09:00:00".to_string(),
        updated_at: "2026-11-19 09:00:00".to_string(),
    };
    assert_type_fields(&source, "Mistake", &serde_json::to_value(&mistake).unwrap());

    let topic_mistake = TopicMistake {
        id: 7,
        subject: "数学".to_string(),
        title: "求 f(x)".to_string(),
        reason: "概念不清".to_string(),
        correct_note: "先看定义域".to_string(),
        is_mastered: 1,
        created_at: "2026-11-19 09:00:00".to_string(),
    };
    assert_type_fields(
        &source,
        "TopicMistake",
        &serde_json::to_value(&topic_mistake).unwrap(),
    );

    let topic_mistakes = TopicMistakes {
        topic_id: "t_basic".to_string(),
        topic_name: "函数".to_string(),
        total: 1,
        pending: 0,
        items: vec![topic_mistake],
    };
    assert_type_fields(
        &source,
        "TopicMistakes",
        &serde_json::to_value(&topic_mistakes).unwrap(),
    );
}

/// 图谱侧看到的错题，错题本里那些字段必须同名。
///
/// [`TopicMistake`] 和 [`Mistake`] 是同一条错题的两种视图：一个在错题本卡片上，
/// 一个在图谱的「我在这里错过」里。字段名一旦分叉，前端就得记两套读法，
/// 很容易一边读对一边读错。
#[test]
fn topic_mistakes_uses_the_same_field_names_as_the_mistake_model() {
    let mistake = Mistake {
        id: 1,
        subject: "数学".to_string(),
        title: "求 f(x)".to_string(),
        reason: "概念不清".to_string(),
        correct_note: "先看定义域".to_string(),
        is_mastered: 0,
        graph_topic_id: Some("t_basic".to_string()),
        graph_subject: Some("math".to_string()),
        graph_topic_name: Some("函数".to_string()),
        created_at: "2026-11-19 09:00:00".to_string(),
        updated_at: "2026-11-19 09:00:00".to_string(),
    };
    let topic = TopicMistake {
        id: 7,
        subject: "数学".to_string(),
        title: "求 f(x)".to_string(),
        reason: "概念不清".to_string(),
        correct_note: "先看定义域".to_string(),
        is_mastered: 1,
        created_at: "2026-11-19 09:00:00".to_string(),
    };

    let mistake_keys = serde_json::to_value(&mistake).unwrap();
    let topic_keys = serde_json::to_value(&topic).unwrap();

    for shared in [
        "id",
        "subject",
        "title",
        "reason",
        "correct_note",
        "is_mastered",
        "created_at",
    ] {
        assert!(
            mistake_keys.get(shared).is_some(),
            "Mistake 少了 {shared}"
        );
        assert!(
            topic_keys.get(shared).is_some(),
            "TopicMistake 少了 {shared}"
        );
    }

    // 图谱侧那侧不需要图谱字段：它本来就是被图谱查出来的。
    for extra in ["graph_topic_id", "graph_subject", "graph_topic_name"] {
        assert!(mistake_keys.get(extra).is_some(), "Mistake 少了 {extra}");
        assert!(
            topic_keys.get(extra).is_none(),
            "TopicMistake 不该有 {extra}"
        );
    }
}

/// 前端 `types.ts` 里某个类型的字段名，必须跟后端序列化出来的键名一致。
fn assert_type_fields(source: &str, type_name: &str, value: &serde_json::Value) {
    let mut backend: Vec<String> = value
        .as_object()
        .expect("后端结构体应该序列化成对象")
        .keys()
        .cloned()
        .collect();
    backend.sort();

    let frontend = ts_type_fields(source, type_name);
    assert_eq!(
        frontend, backend,
        "src/types.ts 里的 {type_name} 字段名跟后端对不上"
    );
}

/// 从 `src/types.ts` 里抠出 `export type X = { ... }` 的字段名。
fn ts_type_fields(source: &str, type_name: &str) -> Vec<String> {
    let marker = format!("export type {type_name} = {{");
    let start = source
        .find(&marker)
        .unwrap_or_else(|| panic!("src/types.ts 里找不到 {type_name}"));
    let body = &source[start + marker.len()..];
    let end = body
        .find("};")
        .unwrap_or_else(|| panic!("src/types.ts 里 {type_name} 的类型块没闭合"));
    let body = &body[..end];

    let mut fields = Vec::new();
    let mut in_block_comment = false;
    for line in body.lines() {
        let line = line.trim();
        if in_block_comment {
            if line.contains("*/") {
                in_block_comment = false;
            }
            continue;
        }
        if line.starts_with("/*") {
            in_block_comment = !line.contains("*/");
            continue;
        }
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        let Some((name, _)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().trim_end_matches('?').to_string();
        if !name.is_empty() {
            fields.push(name);
        }
    }
    fields.sort();
    fields
}
