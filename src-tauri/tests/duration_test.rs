//! Nail duration semantics for completion vs manual log (they intentionally differ).
//!
//! B 段确认：
//! - 完成：`duration_minutes(start,end).max(1)`（`actual_units>0`）；0 单位则 0。
//! - 手动：`compute_duration_min` → 起止差分钟，`max(0)`，允许 0；无 `.max(1)`。
//! - 统计对 `actual_logs` 按 tag/日期 SUM，不按 `session_id` 去重。

use chrono::Local;
use rusqlite::Connection;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::path::PathBuf;
use timequest_lib::{
    complete_session_impl, create_log_impl, create_session_impl, stats_tag_type_totals_impl,
    CreateLogPayload,
};

async fn setup_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("connect");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .unwrap();
    pool
}

async fn open_shared_file_db() -> (PathBuf, SqlitePool, Connection) {
    let path = std::env::temp_dir().join(format!(
        "timequest-duration-{}.db",
        uuid::Uuid::new_v4()
    ));
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    let path_str = path.to_string_lossy().replace('\\', "/");
    let url = format!("sqlite:{path_str}?mode=rwc");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect file");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .unwrap();

    let conn = Connection::open(&path).expect("rusqlite");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .unwrap();
    (path, pool, conn)
}

async fn insert_main_task(pool: &SqlitePool) -> i64 {
    sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round)
           VALUES ('时长测试', 'main', '数学', '课', 40, 1, 1)"#,
    )
    .execute(pool)
    .await
    .unwrap()
    .last_insert_rowid()
}

async fn duration_for_session(pool: &SqlitePool, session_id: i64) -> i64 {
    sqlx::query_scalar("SELECT duration_min FROM actual_logs WHERE session_id = ?1")
        .bind(session_id)
        .fetch_one(pool)
        .await
        .expect("actual_log for session")
}

/// UI「快速记录」传的是 `{date}T{HH:MM}:00`，不是裸 `HH:MM`。
fn clock_at(date: &str, hm: &str) -> String {
    format!("{date}T{hm}:00")
}

#[tokio::test]
async fn completion_duration_uses_session_length_with_min_one() {
    let pool = setup_pool().await;
    let task_id = insert_main_task(&pool).await;

    // 09:00–09:45 → 45
    let s45 = create_session_impl(
        &pool,
        task_id,
        "2026-11-04".into(),
        "09:00".into(),
        "09:45".into(),
        None,
        Some(1),
    )
    .await
    .expect("create 45m session");
    complete_session_impl(
        &pool,
        s45.id,
        1,
        Some(3),
        None,
        false,
        Local::now(),
        None,
    )
    .await
    .expect("complete 45m");
    assert_eq!(duration_for_session(&pool, s45.id).await, 45);

    // 09:00–09:00 → 0 分钟差，守卫抬到 1
    let s0 = create_session_impl(
        &pool,
        task_id,
        "2026-11-05".into(),
        "09:00".into(),
        "09:00".into(),
        None,
        Some(1),
    )
    .await
    .expect("create zero-length session");
    complete_session_impl(
        &pool,
        s0.id,
        1,
        Some(3),
        None,
        false,
        Local::now(),
        None,
    )
    .await
    .expect("complete zero-length");
    assert_eq!(
        duration_for_session(&pool, s0.id).await,
        1,
        "completion path must apply .max(1), not leave 0"
    );
}

#[tokio::test]
async fn manual_log_duration_uses_time_diff_and_allows_zero() {
    let (path, _pool, conn) = open_shared_file_db().await;
    let date = "2026-11-04";

    // start=end at 10:00 → 0（允许；与完成路径不同）
    let zero = create_log_impl(
        &conn,
        CreateLogPayload {
            date: date.into(),
            start_at: Some(clock_at(date, "10:00")),
            end_at: Some(clock_at(date, "10:00")),
            duration_min: None,
            subject: Some("数学".into()),
            method: Some("刷题".into()),
            tag_type: Some("study".into()),
            note: None,
        },
    )
    .expect("manual zero");
    assert_eq!(
        zero.duration_min, 0,
        "manual path allows 0 when start_at == end_at"
    );
    assert!(zero.session_id.is_none());

    // 10:00–10:30 → 30
    let half = create_log_impl(
        &conn,
        CreateLogPayload {
            date: date.into(),
            start_at: Some(clock_at(date, "10:00")),
            end_at: Some(clock_at(date, "10:30")),
            duration_min: None,
            subject: Some("数学".into()),
            method: Some("刷题".into()),
            tag_type: Some("study".into()),
            note: None,
        },
    )
    .expect("manual 30");
    assert_eq!(half.duration_min, 30);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn same_duration_two_paths_produce_different_duration_min() {
    let (path, pool, conn) = open_shared_file_db().await;
    let task_id = insert_main_task(&pool).await;
    let date = "2026-11-04";

    // 完成路径：09:00–09:30，actual_units=1 → duration_min=30，session_id 非空
    let session = create_session_impl(
        &pool,
        task_id,
        date.into(),
        "09:00".into(),
        "09:30".into(),
        None,
        Some(1),
    )
    .await
    .unwrap();
    complete_session_impl(
        &pool,
        session.id,
        1,
        Some(3),
        None,
        false,
        Local::now(),
        None,
    )
    .await
    .unwrap();

    let via_complete: (i64, Option<i64>) = sqlx::query_as(
        "SELECT duration_min, session_id FROM actual_logs WHERE session_id = ?1",
    )
    .bind(session.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(via_complete.0, 30);
    assert_eq!(via_complete.1, Some(session.id));

    // 手动补记：时钟 10:00–10:30 → 同样 30，session_id 为空
    // （与完成路径是两段不同钟点，但“学了 30 分钟”这一事实相同）
    let via_manual = create_log_impl(
        &conn,
        CreateLogPayload {
            date: date.into(),
            start_at: Some(clock_at(date, "10:00")),
            end_at: Some(clock_at(date, "10:30")),
            duration_min: None,
            subject: Some("数学".into()),
            method: Some("刷题".into()),
            tag_type: Some("study".into()),
            note: None,
        },
    )
    .unwrap();
    assert_eq!(via_manual.duration_min, 30);
    assert!(via_manual.session_id.is_none());

    // 来源可区分：session_id 非空 vs 空
    let linked: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM actual_logs WHERE date = ?1 AND session_id IS NOT NULL",
    )
    .bind(date)
    .fetch_one(&pool)
    .await
    .unwrap();
    let unlinked: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM actual_logs WHERE date = ?1 AND session_id IS NULL",
    )
    .bind(date)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(linked, 1);
    assert_eq!(unlinked, 1);

    // 统计页把两者混在一起求和（不对 session_id 去重）→ 合计 60。
    // 同一段实际学习不应被记录两次，这是数据录入纪律问题，不是代码 bug。
    let tags = stats_tag_type_totals_impl(&pool, date, date)
        .await
        .unwrap();
    let study = tags
        .iter()
        .find(|r| r.tag_type == "study")
        .expect("study row");
    assert_eq!(
        study.duration_min, 60,
        "stats sums both paths; no dedupe by session_id"
    );

    let _ = std::fs::remove_file(&path);
}
