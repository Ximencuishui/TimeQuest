//! 图谱知识点接到任务考点上（M2）。
//!
//! 任务考点多带两个字段：`graph_topic_id` 是上游知识点 id，`graph_subject` 是
//! 学科代号。自写考点与教材考点这两个字段为空。导出导入要把它们一起带走。

mod common;

use rusqlite::Connection;
use serde_json::Value;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::path::PathBuf;
use timequest_lib::{
    add_custom_knowledge_point_impl, add_graph_knowledge_point_impl, export_json_impl,
    generate_tasks_from_outline_impl, get_task_knowledge_points_impl, import_json_impl,
    GenerateTasksFromOutlineInput, TextbookError,
};

/// 建一个只有一行数学主线的任务。
async fn seed_task(pool: &SqlitePool, title: &str) -> i64 {
    let inserted = sqlx::query(
        "INSERT INTO tasks (title, type, subject, total_units, total_rounds, current_round)
         VALUES (?1, 'main', '数学', 10, 1, 1)",
    )
    .bind(title)
    .execute(pool)
    .await
    .expect("insert task");
    inserted.last_insert_rowid()
}

/// 一个跑过迁移的临时库，给导出导入用例用。
async fn open_migrated_db() -> (PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!(
        "timequest-graph-points-{}.db",
        uuid::Uuid::new_v4()
    ));
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

/// 图谱考点入库要带着上游 id 和学科代号。
#[tokio::test]
async fn graph_point_carries_the_upstream_topic_id() {
    let pool = common::setup().await;
    let task_id = seed_task(&pool, "数学一轮").await;

    let point = add_graph_knowledge_point_impl(
        &pool,
        task_id,
        "数学".into(),
        "一元二次方程".into(),
        "cnm_001".into(),
        Some("math".into()),
    )
    .await
    .expect("add graph point");

    assert_eq!(point.graph_topic_id.as_deref(), Some("cnm_001"));
    assert_eq!(point.graph_subject.as_deref(), Some("math"));
    assert_eq!(point.section_name, "数学");
    assert_eq!(point.name, "一元二次方程");
    assert_eq!(point.is_mastered, 0);

    let listed = get_task_knowledge_points_impl(&pool, task_id)
        .await
        .expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].graph_topic_id.as_deref(), Some("cnm_001"));
    assert_eq!(listed[0].graph_subject.as_deref(), Some("math"));
}

/// 自写考点与教材考点没有图谱 id。
#[tokio::test]
async fn custom_point_has_no_graph_topic_id() {
    let pool = common::setup().await;
    let task_id = seed_task(&pool, "数学一轮").await;

    let point =
        add_custom_knowledge_point_impl(&pool, task_id, "自定义节".into(), "韦达定理".into())
            .await
            .expect("add custom point");

    assert!(point.graph_topic_id.is_none());
    assert!(point.graph_subject.is_none());

    let listed = get_task_knowledge_points_impl(&pool, task_id)
        .await
        .expect("list");
    assert!(listed[0].graph_topic_id.is_none());
}

/// 教材导入生成的考点同样没有图谱 id。
#[tokio::test]
async fn textbook_generated_points_have_no_graph_topic_id() {
    let pool = common::setup().await;
    let result = generate_tasks_from_outline_impl(
        &pool,
        GenerateTasksFromOutlineInput {
            subject: "数学".into(),
            version: "人教版".into(),
            volume: "必修第一册".into(),
            task_name: "数学一轮".into(),
            selected_sections: vec![],
            auto_schedule: false,
        },
    )
    .await
    .expect("generate tasks");

    let listed = get_task_knowledge_points_impl(&pool, result.task_id)
        .await
        .expect("list");
    assert!(!listed.is_empty());
    assert!(
        listed.iter().all(|point| point.graph_topic_id.is_none()),
        "教材考点不该带图谱 id"
    );
}

/// 同一个图谱考点在一个任务里只能加一次。
#[tokio::test]
async fn graph_topic_cannot_be_added_twice_to_one_task() {
    let pool = common::setup().await;
    let task_id = seed_task(&pool, "数学一轮").await;

    let first = add_graph_knowledge_point_impl(
        &pool,
        task_id,
        "数学".into(),
        "一元二次方程".into(),
        "cnm_001".into(),
        Some("math".into()),
    )
    .await
    .expect("first add");

    let again = add_graph_knowledge_point_impl(
        &pool,
        task_id,
        "数学".into(),
        "一元二次方程".into(),
        "cnm_001".into(),
        Some("math".into()),
    )
    .await;
    assert!(
        matches!(again, Err(TextbookError::DuplicateGraphTopic)),
        "同一个图谱考点不能重复加: {again:?}"
    );

    // 换个节名、换个显示名也算同一个考点。
    let renamed = add_graph_knowledge_point_impl(
        &pool,
        task_id,
        "另一节".into(),
        "一元二次方程（换个名字）".into(),
        "cnm_001".into(),
        Some("math".into()),
    )
    .await;
    assert!(
        matches!(renamed, Err(TextbookError::DuplicateGraphTopic)),
        "图谱考点按 id 去重，不按名字: {renamed:?}"
    );

    // 已有那行没被动过。
    let listed = get_task_knowledge_points_impl(&pool, task_id)
        .await
        .expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, first.id);
    assert_eq!(listed[0].name, "一元二次方程");
    assert_eq!(listed[0].is_mastered, 0);
}

/// 同一个图谱考点可以进不同的任务。
#[tokio::test]
async fn same_graph_topic_can_join_another_task() {
    let pool = common::setup().await;
    let first_task = seed_task(&pool, "数学一轮").await;
    let second_task = seed_task(&pool, "数学补强").await;

    for task_id in [first_task, second_task] {
        let point = add_graph_knowledge_point_impl(
            &pool,
            task_id,
            "数学".into(),
            "一元二次方程".into(),
            "cnm_001".into(),
            Some("math".into()),
        )
        .await
        .expect("add to task");
        assert_eq!(point.graph_topic_id.as_deref(), Some("cnm_001"));
    }
}

/// 上游 id 为空要报错，别塞一条没来源的图谱考点。
#[tokio::test]
async fn graph_point_with_blank_topic_id_is_rejected() {
    let pool = common::setup().await;
    let task_id = seed_task(&pool, "数学一轮").await;

    let blank = add_graph_knowledge_point_impl(
        &pool,
        task_id,
        "数学".into(),
        "一元二次方程".into(),
        "   ".into(),
        Some("math".into()),
    )
    .await;
    assert!(
        matches!(blank, Err(TextbookError::EmptyGraphTopicId)),
        "空的上游 id 要报错: {blank:?}"
    );

    let listed = get_task_knowledge_points_impl(&pool, task_id)
        .await
        .expect("list");
    assert!(listed.is_empty());
}

/// 任务不存在时不许挂考点。
#[tokio::test]
async fn graph_point_on_a_missing_task_is_rejected() {
    let pool = common::setup().await;

    let missing = add_graph_knowledge_point_impl(
        &pool,
        10_000,
        "数学".into(),
        "一元二次方程".into(),
        "cnm_001".into(),
        Some("math".into()),
    )
    .await;
    assert!(
        matches!(missing, Err(TextbookError::TaskNotFound { .. })),
        "任务不存在时要报错: {missing:?}"
    );
}

/// 导出再导入，图谱 id 不能丢。
#[tokio::test]
async fn graph_points_survive_export_import() {
    let (path, conn) = open_migrated_db().await;
    conn.execute(
        "INSERT INTO tasks (id, title, type, subject, total_units, total_rounds, current_round)
         VALUES (1, '数学一轮', 'main', '数学', 10, 1, 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO task_knowledge_points
           (task_id, section_name, name, is_mastered, position, graph_topic_id, graph_subject)
         VALUES (1, '数学', '一元二次方程', 0, 0, 'cnm_001', 'math')",
        [],
    )
    .unwrap();

    let payload = export_json_impl(&conn).expect("export");
    let parsed: Value = serde_json::from_str(&payload).expect("parse export");
    assert_eq!(parsed["task_knowledge_points"][0]["graph_topic_id"], "cnm_001");
    assert_eq!(parsed["task_knowledge_points"][0]["graph_subject"], "math");

    import_json_impl(&conn, &payload).expect("import");
    let (topic, subject): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT graph_topic_id, graph_subject FROM task_knowledge_points WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(topic.as_deref(), Some("cnm_001"));
    assert_eq!(subject.as_deref(), Some("math"));

    let _ = std::fs::remove_file(&path);
}

/// 老备份里没有图谱字段，导入后留空，不能报错。
#[tokio::test]
async fn old_backup_without_graph_fields_imports_as_null() {
    let (path, conn) = open_migrated_db().await;
    conn.execute(
        "INSERT INTO tasks (id, title, type, subject, total_units, total_rounds, current_round)
         VALUES (1, '数学一轮', 'main', '数学', 10, 1, 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO task_knowledge_points (task_id, section_name, name, is_mastered, position)
         VALUES (1, '第一章 有理数', '有理数', 0, 0)",
        [],
    )
    .unwrap();

    let mut payload: Value =
        serde_json::from_str(&export_json_impl(&conn).expect("export")).expect("parse export");
    // 模拟老备份：这两个键压根没有。
    if let Some(rows) = payload["task_knowledge_points"].as_array_mut() {
        for row in rows.iter_mut() {
            if let Some(obj) = row.as_object_mut() {
                obj.remove("graph_topic_id");
                obj.remove("graph_subject");
            }
        }
    }

    import_json_impl(&conn, &payload.to_string()).expect("old backup import");

    let (name, topic, subject): (String, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT name, graph_topic_id, graph_subject FROM task_knowledge_points",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(name, "有理数");
    assert!(topic.is_none(), "老备份导入后图谱 id 应为空");
    assert!(subject.is_none(), "老备份导入后学科代号应为空");

    let _ = std::fs::remove_file(&path);
}
