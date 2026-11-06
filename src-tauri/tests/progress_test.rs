//! Progress ring vs `first_round`口径（C 段）。
//!
//! - `task_progress.round_units`：`SUM(actual_units) WHERE round = tasks.current_round AND status='done'`
//! - `first_round`：完成时按当场 `session.round` 合计，不读 `current_round`
//! - 推进后旧轮从进度环消失；旧轮补完成仍可能触及 first_round 判定轮次（幂等不重复解锁）

use chrono::Local;
use rusqlite::Connection;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::path::PathBuf;
use timequest_lib::{
    advance_round_impl, complete_session_impl, create_session_impl, task_progress_impl,
};

async fn open_shared() -> (PathBuf, SqlitePool, Connection) {
    let path = std::env::temp_dir().join(format!("timequest-progress-{}.db", uuid::Uuid::new_v4()));
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    let path_str = path.to_string_lossy().replace('\\', "/");
    let url = format!("sqlite:{path_str}?mode=rwc");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let conn = Connection::open(&path).expect("rusqlite");
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    (path, pool, conn)
}

async fn insert_main(
    pool: &SqlitePool,
    total_units: i64,
    total_rounds: i64,
    current_round: i64,
) -> i64 {
    sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round)
           VALUES ('进度测试', 'main', '数学', '课', ?1, ?2, ?3)"#,
    )
    .bind(total_units)
    .bind(total_rounds)
    .bind(current_round)
    .execute(pool)
    .await
    .unwrap()
    .last_insert_rowid()
}

#[tokio::test]
async fn progress_ring_follows_current_round() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_main(&pool, 20, 2, 1).await;

    let s1 = create_session_impl(
        &pool,
        task_id,
        "2026-11-01".into(),
        "09:00".into(),
        "10:00".into(),
        Some(1),
        Some(6),
    )
    .await
    .unwrap();
    complete_session_impl(&pool, s1.id, 6, Some(3), None, false, Local::now(), None)
        .await
        .unwrap();

    let s2 = create_session_impl(
        &pool,
        task_id,
        "2026-11-02".into(),
        "09:00".into(),
        "10:00".into(),
        Some(1),
        Some(4),
    )
    .await
    .unwrap();
    complete_session_impl(&pool, s2.id, 4, Some(3), None, false, Local::now(), None)
        .await
        .unwrap();

    let p1 = task_progress_impl(&conn, task_id).expect("progress r1");
    assert_eq!(p1.round_units, 10, "round 1: 6+4");
    assert_eq!(p1.total_units_done, 10);

    advance_round_impl(&pool, task_id).await.unwrap();
    let cur: i64 = sqlx::query_scalar("SELECT current_round FROM tasks WHERE id = ?1")
        .bind(task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cur, 2);

    let p2 = task_progress_impl(&conn, task_id).expect("progress after advance");
    assert_eq!(
        p2.round_units, 0,
        "current round 2 has no done sessions; old 10 must leave the ring"
    );
    assert_eq!(
        p2.total_units_done, 10,
        "lifetime total still includes round 1"
    );

    let s3 = create_session_impl(
        &pool,
        task_id,
        "2026-11-03".into(),
        "09:00".into(),
        "10:00".into(),
        Some(2),
        Some(7),
    )
    .await
    .unwrap();
    complete_session_impl(&pool, s3.id, 7, Some(3), None, false, Local::now(), None)
        .await
        .unwrap();

    let p3 = task_progress_impl(&conn, task_id).expect("progress r2");
    assert_eq!(p3.round_units, 7, "only round-2 units on the ring");
    assert_eq!(p3.total_units_done, 17);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn progress_ring_and_first_round_can_disagree() {
    // 进度环看当前轮，first_round 看完成时的轮次，两者口径不同是有意为之。
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_main(&pool, 10, 2, 1).await;

    let s1 = create_session_impl(
        &pool,
        task_id,
        "2026-11-01".into(),
        "09:00".into(),
        "10:00".into(),
        Some(1),
        Some(10),
    )
    .await
    .unwrap();
    let r1 = complete_session_impl(&pool, s1.id, 10, Some(3), None, false, Local::now(), None)
        .await
        .unwrap();
    assert!(
        r1.new_achievements.iter().any(|a| a == "first_round"),
        "round-1 reaching total_units unlocks first_round"
    );

    advance_round_impl(&pool, task_id).await.unwrap();

    // 旧轮补记：显式 round=1（不是 current_round=2）
    let s2 = create_session_impl(
        &pool,
        task_id,
        "2026-11-02".into(),
        "09:00".into(),
        "10:00".into(),
        Some(1),
        Some(3),
    )
    .await
    .unwrap();
    let r2 = complete_session_impl(&pool, s2.id, 3, Some(3), None, false, Local::now(), None)
        .await
        .unwrap();

    // a. 进度环仍只看 current_round=2 → 0（S2 的 3 被排除）
    let progress = task_progress_impl(&conn, task_id).unwrap();
    assert_eq!(
        progress.round_units, 0,
        "S2 is round=1; must not enter current-round ring"
    );

    // b. first_round 不因 S2 再解锁（按 session.round=1 判定，已解锁过）
    assert!(
        !r2.new_achievements.iter().any(|a| a == "first_round"),
        "first_round must stay idempotent"
    );
    let fr_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_achievements WHERE achievement_id = 'first_round'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(fr_rows, 1);

    let _ = std::fs::remove_file(&path);
}

/// C 段确认：`advance_round` 无 `total_rounds` 封顶；`task_progress` 按
/// `session.round = tasks.current_round` 过滤，过顶后无该轮 done → `round_units=0`。
#[tokio::test]
async fn progress_ring_on_round_past_total_rounds() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_main(&pool, 10, 2, 1).await;

    let s1 = create_session_impl(
        &pool,
        task_id,
        "2026-11-01".into(),
        "09:00".into(),
        "10:00".into(),
        Some(1),
        Some(10),
    )
    .await
    .unwrap();
    let r1 = complete_session_impl(&pool, s1.id, 10, Some(3), None, false, Local::now(), None)
        .await
        .unwrap();
    assert!(
        r1.new_achievements.iter().any(|a| a == "first_round"),
        "round 1 @ total_units unlocks first_round"
    );

    // 1 → 2 → 3，越过 total_rounds=2
    advance_round_impl(&pool, task_id).await.unwrap();
    let advanced = advance_round_impl(&pool, task_id).await.unwrap();
    assert_eq!(advanced.current_round, 3);
    assert_eq!(advanced.total_rounds, 2);

    // a. 过顶当前轮无 done → 0，Ok（不报错）
    let progress = task_progress_impl(&conn, task_id).expect("a. progress past total_rounds");
    assert_eq!(
        progress.round_units, 0,
        "a. current_round=3 has no done sessions"
    );
    assert_eq!(
        progress.total_units_done, 10,
        "a. lifetime still includes round 1"
    );

    // b. 前端 TaskDetail 文案为「当前第 {current_round} / {total_rounds} 轮」，
    //    无钳制、无「已超出」——过顶时原样显示 3/2。Rust 侧钉住数据字段。
    assert_eq!(advanced.current_round, 3, "b. display source N=3");
    assert_eq!(advanced.total_rounds, 2, "b. display source M=2 → UI 3/2");

    // c. first_round 不因过顶重置
    let fr_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_achievements WHERE achievement_id = 'first_round'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        fr_rows, 1,
        "c. first_round stays a single row after over-cap"
    );

    let _ = std::fs::remove_file(&path);
}

/// 接 A：过顶后完成 round=3 达标场次。
///
/// C 段 1c：`first_round` **不是** `session.round == current_round` 过滤；
/// 按当场 `session.round` 做 `SUM(actual_units)`，且全局只解锁一次。
/// 本用例 A 已解锁 → 过顶第 3 轮再达标不重复插入（「只解锁一次」）。
///
/// two-side：完成时 `current_round=3` 且 `session.round=3`，进度环与成就合计都看 round=3，
/// 但成就侧因已有行而不再写入——环有单位、成就仍一行。
#[tokio::test]
async fn first_round_can_unlock_on_round_past_total_rounds() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_main(&pool, 10, 2, 1).await;

    let s1 = create_session_impl(
        &pool,
        task_id,
        "2026-11-01".into(),
        "09:00".into(),
        "10:00".into(),
        Some(1),
        Some(10),
    )
    .await
    .unwrap();
    complete_session_impl(&pool, s1.id, 10, Some(3), None, false, Local::now(), None)
        .await
        .unwrap();

    advance_round_impl(&pool, task_id).await.unwrap();
    advance_round_impl(&pool, task_id).await.unwrap();
    let cur: i64 = sqlx::query_scalar("SELECT current_round FROM tasks WHERE id = ?1")
        .bind(task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cur, 3);

    let s2 = create_session_impl(
        &pool,
        task_id,
        "2026-11-04".into(),
        "09:00".into(),
        "10:00".into(),
        Some(3),
        Some(10),
    )
    .await
    .unwrap();
    let r2 = complete_session_impl(&pool, s2.id, 10, Some(3), None, false, Local::now(), None)
        .await
        .unwrap();

    // 只解锁一次：不因过顶 round=3 再插
    assert!(
        !r2.new_achievements.iter().any(|a| a == "first_round"),
        "first_round already unlocked in round 1; over-cap round 3 must not re-unlock"
    );
    let fr_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_achievements WHERE achievement_id = 'first_round'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(fr_rows, 1, "still exactly one first_round row");

    // 进度环：过顶当前轮合计 = S2 的 10（与成就合计轮次相同，但成就幂等）
    let progress = task_progress_impl(&conn, task_id).unwrap();
    assert_eq!(
        progress.round_units, 10,
        "ring follows current_round=3 after S2 done"
    );
    assert_eq!(progress.total_units_done, 20);

    let _ = std::fs::remove_file(&path);
}

// 测试 C：`task_detail_does_not_crash_when_current_exceeds_total` — 跳过。
// 无 Rust `task_detail_summary`；详情「第 N / 共 M 轮」在前端 TaskDetail 直接插值。
// 前端待办：过顶时原样显示 3/2（见 progress_ring_on_round_past_total_rounds 注释 b）。
