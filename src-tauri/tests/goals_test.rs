//! Countdown goals: CRUD, single primary, delete fallback, export/import round trip.

use rusqlite::Connection;
use serde_json::Value;
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use timequest_lib::{
    export_json_impl, import_json_impl, list_goals_impl, remove_goal_impl, seed_default_goal_impl,
    set_primary_goal_impl, upsert_goal_impl, Goal, UpsertGoalPayload, DEFAULT_GOAL_DATE,
    DEFAULT_GOAL_NAME,
};

async fn open_rusqlite_migrated() -> (PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("timequest-goals-{}.db", uuid::Uuid::new_v4()));
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

fn payload(name: &str, date: &str, is_primary: bool) -> UpsertGoalPayload {
    UpsertGoalPayload {
        id: None,
        track_id: None,
        name: name.to_string(),
        date: date.to_string(),
        kind: None,
        is_primary: Some(is_primary),
        target_score: None,
        clear_target_score: None,
    }
}

fn primary_count(goals: &[Goal]) -> usize {
    goals.iter().filter(|goal| goal.is_primary).count()
}

#[tokio::test]
async fn goals_crud_validates_and_keeps_one_primary() {
    let (path, conn) = open_rusqlite_migrated().await;

    // 建表后是空的。
    assert!(list_goals_impl(&conn).unwrap().is_empty());

    // 名称不能空。
    let err = upsert_goal_impl(&conn, payload("   ", "2027-06-07", false)).expect_err("blank name");
    assert!(err.contains("名称"), "got {err}");

    // 日期格式必须是 YYYY-MM-DD。
    let err = upsert_goal_impl(&conn, payload("高考", "not-a-date", false)).expect_err("bad date");
    assert!(err.contains("日期"), "got {err}");
    let err = upsert_goal_impl(&conn, payload("高考", "2027-13-40", false)).expect_err("bad date");
    assert!(err.contains("日期"), "got {err}");

    // 类型要走白名单。
    let mut bad_kind = payload("高考", "2027-06-07", false);
    bad_kind.kind = Some("unknown".to_string());
    let err = upsert_goal_impl(&conn, bad_kind).expect_err("bad kind");
    assert!(err.contains("类型"), "got {err}");

    // 目标分数不能是负数。
    let mut negative = payload("高考", "2027-06-07", false);
    negative.target_score = Some(-1.0);
    let err = upsert_goal_impl(&conn, negative).expect_err("negative score");
    assert!(err.contains("负数"), "got {err}");

    // 校验失败时表里不能留下半截数据。
    assert!(list_goals_impl(&conn).unwrap().is_empty());

    // 正常写入：日期会被规范化成 YYYY-MM-DD。
    let exam = upsert_goal_impl(&conn, payload("  高考  ", "2027-6-7", true)).expect("create");
    assert_eq!(exam.name, "高考");
    assert_eq!(exam.date, "2027-06-07");
    assert_eq!(exam.kind, "exam");
    assert!(exam.is_primary);
    assert_eq!(exam.target_score, None);

    let mock = upsert_goal_impl(&conn, payload("第一次模考", "2026-11-25", false)).expect("create 2");
    assert!(!mock.is_primary);

    let listed = list_goals_impl(&conn).unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, exam.id, "primary comes first");
    assert_eq!(listed[1].id, mock.id);
    assert_eq!(primary_count(&listed), 1);

    // 改成主目标：其它目标自动降级。
    set_primary_goal_impl(&conn, mock.id).expect("set primary");
    let listed = list_goals_impl(&conn).unwrap();
    assert_eq!(primary_count(&listed), 1);
    assert!(listed.iter().find(|g| g.id == mock.id).unwrap().is_primary);
    assert!(!listed.iter().find(|g| g.id == exam.id).unwrap().is_primary);

    // upsert 里带 is_primary=true 也一样只留一个。
    upsert_goal_impl(
        &conn,
        UpsertGoalPayload {
            id: Some(exam.id),
            track_id: None,
            name: "高考".to_string(),
            date: "2027-06-07".to_string(),
            kind: None,
            is_primary: Some(true),
            target_score: None,
            clear_target_score: None,
        },
    )
    .expect("promote via upsert");
    let listed = list_goals_impl(&conn).unwrap();
    assert_eq!(primary_count(&listed), 1);
    assert!(listed.iter().find(|g| g.id == exam.id).unwrap().is_primary);

    // 改一条：名称 / 日期会更新，id 不变。
    let updated = upsert_goal_impl(
        &conn,
        UpsertGoalPayload {
            id: Some(exam.id),
            track_id: None,
            name: "高考（普通类）".to_string(),
            date: "2028-06-07".to_string(),
            kind: Some("milestone".to_string()),
            is_primary: None,
            target_score: Some(650.0),
            clear_target_score: None,
        },
    )
    .expect("update");
    assert_eq!(updated.id, exam.id);
    assert_eq!(updated.name, "高考（普通类）");
    assert_eq!(updated.date, "2028-06-07");
    assert_eq!(updated.kind, "milestone");
    assert_eq!(updated.target_score, Some(650.0));
    assert!(updated.is_primary, "update must not silently drop the primary flag");

    // 改不存在的目标会报错。
    let err = upsert_goal_impl(
        &conn,
        UpsertGoalPayload {
            id: Some(9999),
            track_id: None,
            name: "不存在".to_string(),
            date: "2027-06-07".to_string(),
            kind: None,
            is_primary: None,
            target_score: None,
            clear_target_score: None,
        },
    )
    .expect_err("missing goal");
    assert!(err.contains("不存在"), "got {err}");

    // 删掉主目标后，剩下最早的一条自动顶上。
    remove_goal_impl(&conn, exam.id).expect("remove primary");
    let listed = list_goals_impl(&conn).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(primary_count(&listed), 1);
    assert_eq!(listed[0].id, mock.id);

    // 删不存在的目标会报错。
    let err = remove_goal_impl(&conn, exam.id).expect_err("already gone");
    assert!(err.contains("不存在"), "got {err}");

    let err = set_primary_goal_impl(&conn, exam.id).expect_err("missing goal");
    assert!(err.contains("不存在"), "got {err}");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn goals_seed_default_goal_is_idempotent() {
    let (path, conn) = open_rusqlite_migrated().await;

    seed_default_goal_impl(&conn).expect("seed");
    let listed = list_goals_impl(&conn).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, DEFAULT_GOAL_NAME);
    assert_eq!(listed[0].date, DEFAULT_GOAL_DATE);
    assert!(listed[0].is_primary);

    // 再跑一次不会多出重复行。
    seed_default_goal_impl(&conn).expect("seed again");
    assert_eq!(list_goals_impl(&conn).unwrap().len(), 1);

    // 已经有目标时不再补默认目标。
    let _ = std::fs::remove_file(&path);
}

/// 总分目标必须真的能被清空：`COALESCE` 语义下 null 与「不传」同义，
/// 所以清空要走显式开关（`clear_target_score`）。
#[tokio::test]
async fn goal_total_target_can_be_cleared_explicitly() {
    let (path, conn) = open_rusqlite_migrated().await;

    let mut with_score = payload("高考", "2027-06-07", true);
    with_score.target_score = Some(650.0);
    let created = upsert_goal_impl(&conn, with_score).expect("create");
    assert_eq!(created.target_score, Some(650.0));

    // 不带清空开关的更新：总分目标保持原样。
    let mut rename_only = payload("高考（普通类）", "2027-06-07", true);
    rename_only.id = Some(created.id);
    let kept = upsert_goal_impl(&conn, rename_only).expect("update without clear");
    assert_eq!(kept.target_score, Some(650.0));

    // 带上清空开关：总分目标被真的清掉。
    let mut clear = payload("高考（普通类）", "2027-06-07", true);
    clear.id = Some(created.id);
    clear.clear_target_score = Some(true);
    let cleared = upsert_goal_impl(&conn, clear).expect("update with clear");
    assert_eq!(cleared.target_score, None);

    let listed = list_goals_impl(&conn).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].target_score, None);

    let _ = std::fs::remove_file(&path);
}

/// 档案里没有总分目标时，播种出来的目标也不该带分值。
#[tokio::test]
async fn seeded_goal_leaves_the_total_target_empty_when_the_profile_has_none() {
    let (path, conn) = open_rusqlite_migrated().await;

    // 新档案：总分目标可空，默认就是空。
    conn.execute("UPDATE user_profile SET total_target = NULL WHERE id = 1", [])
        .expect("clear total target");

    seed_default_goal_impl(&conn).expect("seed");
    let listed = list_goals_impl(&conn).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].target_score, None);

    let _ = std::fs::remove_file(&path);
}

/// 档案里的总分目标照旧搬到目标上（老用户的目标线不能丢）。
#[tokio::test]
async fn seeded_goal_copies_the_profile_total_target() {
    let (path, conn) = open_rusqlite_migrated().await;

    conn.execute("UPDATE user_profile SET total_target = 565 WHERE id = 1", [])
        .expect("set total target");

    seed_default_goal_impl(&conn).expect("seed");
    let listed = list_goals_impl(&conn).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].target_score, Some(565.0));

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn goals_survive_export_import_round_trip() {
    let (path, conn) = open_rusqlite_migrated().await;

    let exam = upsert_goal_impl(&conn, payload("高考", "2027-06-07", true)).expect("create");
    let mock = upsert_goal_impl(&conn, payload("第一次模考", "2026-11-25", false)).expect("create 2");

    let exported = export_json_impl(&conn).expect("export");
    let json: Value = serde_json::from_str(&exported).expect("payload json");
    assert_eq!(json.get("version").and_then(|v| v.as_i64()), Some(2));
    let goals = json.get("goals").and_then(|v| v.as_array()).expect("goals key");
    assert_eq!(goals.len(), 2);
    assert!(goals
        .iter()
        .all(|row| row.get("name").and_then(|v| v.as_str()).is_some()));

    // 清库后导入，目标要原样回来。
    remove_goal_impl(&conn, exam.id).unwrap();
    remove_goal_impl(&conn, mock.id).unwrap();
    assert!(list_goals_impl(&conn).unwrap().is_empty());

    import_json_impl(&conn, &exported).expect("import");
    let restored = list_goals_impl(&conn).unwrap();
    assert_eq!(restored.len(), 2);
    assert_eq!(primary_count(&restored), 1);
    let primary = restored.iter().find(|g| g.is_primary).unwrap();
    assert_eq!(primary.name, "高考");
    assert_eq!(primary.date, "2027-06-07");
    assert!(restored
        .iter()
        .any(|g| g.name == "第一次模考" && g.date == "2026-11-25"));

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn goals_import_v1_payload_without_goals_key_falls_back_to_default() {
    let (path, conn) = open_rusqlite_migrated().await;

    // v1 备份没有 goals 键：导入不能报错，也不能把表留空。
    let v1 = r#"{
      "version": 1,
      "exported_at": "2026-11-01T00:00:00+08:00",
      "tasks": [],
      "task_sessions": [],
      "actual_logs": [],
      "notes": [],
      "mistakes": [],
      "user_stats": null,
      "user_achievements": [],
      "user_profile": null,
      "app_settings": [],
      "imported_textbooks": [],
      "exam_records": [],
      "task_knowledge_points": []
    }"#;
    import_json_impl(&conn, v1).expect("import v1");

    let restored = list_goals_impl(&conn).unwrap();
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].name, DEFAULT_GOAL_NAME);
    assert_eq!(restored[0].date, DEFAULT_GOAL_DATE);
    assert!(restored[0].is_primary);

    let _ = std::fs::remove_file(&path);
}
