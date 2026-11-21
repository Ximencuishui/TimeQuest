mod common;

use chrono::Local;
use sqlx::SqlitePool;
use timequest_lib::ensure_today_schedule_impl;

fn today() -> String {
    Local::now().date_naive().format("%Y-%m-%d").to_string()
}

/// 插一个主线任务。`total_units` 为 `None` 表示不限总量。
async fn insert_task(
    pool: &SqlitePool,
    task_type: &str,
    total_units: Option<i64>,
    archived: i64,
    deleted: bool,
) -> i64 {
    let task = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, textbook, unit_name, total_units, total_rounds, current_round, color, archived)
           VALUES ('测试任务', ?1, '数学', '课本A', '节', ?2, 1, 1, '#F97316', ?3)"#,
    )
    .bind(task_type)
    .bind(total_units)
    .bind(archived)
    .execute(pool)
    .await
    .expect("insert task");
    let id = task.last_insert_rowid();
    if deleted {
        sqlx::query("UPDATE tasks SET deleted_at = datetime('now','localtime') WHERE id = ?1")
            .bind(id)
            .execute(pool)
            .await
            .expect("mark task deleted");
    }
    id
}

async fn set_setting(pool: &SqlitePool, key: &str, value: &str) {
    sqlx::query(
        r#"INSERT INTO app_settings (key, value, updated_at)
           VALUES (?1, ?2, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"#,
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .expect("set setting");
}

async fn insert_session(
    pool: &SqlitePool,
    task_id: i64,
    date: &str,
    start_time: &str,
    end_time: &str,
    status: &str,
    actual_units: i64,
) -> i64 {
    let row = sqlx::query(
        r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, status, planned_units, actual_units)
           VALUES (?1, ?2, ?3, ?4, 1, ?5, 1, ?6)"#,
    )
    .bind(task_id)
    .bind(date)
    .bind(start_time)
    .bind(end_time)
    .bind(status)
    .bind(actual_units)
    .execute(pool)
    .await
    .expect("insert session");
    row.last_insert_rowid()
}

/// 当天的排期：`(task_id, start_time, end_time, status)`。
async fn sessions_on(pool: &SqlitePool, date: &str) -> Vec<(i64, String, String, String)> {
    sqlx::query_as(
        "SELECT task_id, start_time, end_time, status FROM task_sessions
         WHERE date = ?1 ORDER BY start_time ASC, id ASC",
    )
    .bind(date)
    .fetch_all(pool)
    .await
    .expect("select sessions")
}

async fn session_count(pool: &SqlitePool, date: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions WHERE date = ?1")
        .bind(date)
        .fetch_one(pool)
        .await
        .expect("count sessions")
}

#[tokio::test]
async fn ensure_today_schedule_creates_sessions_for_main_tasks() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool, "main", Some(40), 0, false).await;

    let result = ensure_today_schedule_impl(&pool, None)
        .await
        .expect("ensure today schedule");

    assert_eq!(result.date, today());
    assert_eq!(result.created, 3);
    assert_eq!(result.skipped, 0);
    assert_eq!(result.task_ids, vec![task_id]);

    let rows = sessions_on(&pool, &today()).await;
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].1, "08:00");
    assert_eq!(rows[0].2, "09:00");
    assert_eq!(rows[1].1, "14:00");
    assert_eq!(rows[2].1, "19:00");
    assert!(rows.iter().all(|row| row.0 == task_id));
    assert!(rows.iter().all(|row| row.3 == "planned"));
}

#[tokio::test]
async fn ensure_today_schedule_rotates_between_subjects() {
    let pool = common::setup().await;
    let math = insert_task(&pool, "main", Some(40), 0, false).await;
    let physics = insert_task(&pool, "main", Some(40), 0, false).await;

    let result = ensure_today_schedule_impl(&pool, None)
        .await
        .expect("ensure today schedule");

    assert_eq!(result.created, 3);
    assert_eq!(result.task_ids, vec![math, physics]);

    let rows = sessions_on(&pool, &today()).await;
    assert_eq!(rows.len(), 3);
    // 轮流占时段：数学、物理、数学，两科都排上了。
    assert_eq!(rows[0].0, math);
    assert_eq!(rows[1].0, physics);
    assert_eq!(rows[2].0, math);
}

#[tokio::test]
async fn ensure_today_schedule_is_idempotent_on_second_run() {
    let pool = common::setup().await;
    insert_task(&pool, "main", Some(40), 0, false).await;

    let first = ensure_today_schedule_impl(&pool, None)
        .await
        .expect("first run");
    let second = ensure_today_schedule_impl(&pool, None)
        .await
        .expect("second run");

    assert_eq!(first.created, 3);
    assert_eq!(second.created, 0);
    assert!(second.task_ids.is_empty());
    assert_eq!(session_count(&pool, &today()).await, 3);
}

#[tokio::test]
async fn ensure_today_schedule_skips_day_that_already_has_sessions() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool, "main", Some(40), 0, false).await;
    insert_session(
        &pool,
        task_id,
        &today(),
        "07:00",
        "08:00",
        "planned",
        0,
    )
    .await;

    let result = ensure_today_schedule_impl(&pool, None)
        .await
        .expect("ensure today schedule");

    // 用户自己排过今天，应用不插手。
    assert_eq!(result.created, 0);
    assert_eq!(session_count(&pool, &today()).await, 1);
}

#[tokio::test]
async fn ensure_today_schedule_fills_day_with_only_rescheduled_rows() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool, "main", Some(40), 0, false).await;
    // 这一场已经挪走了，今天确实还空着。
    insert_session(
        &pool,
        task_id,
        &today(),
        "07:00",
        "08:00",
        "rescheduled",
        0,
    )
    .await;

    let result = ensure_today_schedule_impl(&pool, None)
        .await
        .expect("ensure today schedule");

    assert_eq!(result.created, 3);
    assert_eq!(session_count(&pool, &today()).await, 4);
}

#[tokio::test]
async fn ensure_today_schedule_respects_disabled_setting() {
    let pool = common::setup().await;
    insert_task(&pool, "main", Some(40), 0, false).await;
    set_setting(&pool, "auto_schedule_today", "0").await;

    let result = ensure_today_schedule_impl(&pool, None)
        .await
        .expect("ensure today schedule");

    assert_eq!(result.created, 0);
    assert_eq!(session_count(&pool, &today()).await, 0);
}

#[tokio::test]
async fn ensure_today_schedule_ignores_archived_side_and_deleted_tasks() {
    let pool = common::setup().await;
    insert_task(&pool, "main", Some(40), 1, false).await; // 搁置的主线
    insert_task(&pool, "side", Some(40), 0, false).await; // 副本
    insert_task(&pool, "main", Some(40), 0, true).await; // 回收站里的主线

    let result = ensure_today_schedule_impl(&pool, None)
        .await
        .expect("ensure today schedule");

    assert_eq!(result.created, 0);
    assert!(result.task_ids.is_empty());
    assert_eq!(session_count(&pool, &today()).await, 0);
}

#[tokio::test]
async fn ensure_today_schedule_skips_tasks_whose_round_is_already_full() {
    let pool = common::setup().await;
    // 本轮只要 2 课，已经学满 2 课：得先推进轮次才有下一轮可排。
    let task_id = insert_task(&pool, "main", Some(2), 0, false).await;
    insert_session(
        &pool,
        task_id,
        &today(),
        "07:00",
        "08:00",
        "done",
        2,
    )
    .await;

    let result = ensure_today_schedule_impl(&pool, None)
        .await
        .expect("ensure today schedule");

    assert_eq!(result.created, 0);
    assert_eq!(session_count(&pool, &today()).await, 1);
}

#[tokio::test]
async fn ensure_today_schedule_respects_daily_limit() {
    let pool = common::setup().await;
    insert_task(&pool, "main", Some(40), 0, false).await;
    // 每天只学 1 小时：默认三段里只能排下第一段。
    set_setting(&pool, "daily_limit_minutes", "60").await;

    let result = ensure_today_schedule_impl(&pool, None)
        .await
        .expect("ensure today schedule");

    assert_eq!(result.created, 1);
    assert_eq!(result.skipped, 2);
    let rows = sessions_on(&pool, &today()).await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].1, "08:00");
}
