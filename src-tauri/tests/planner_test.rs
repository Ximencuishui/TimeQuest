mod common;

use chrono::Local;
use sqlx::SqlitePool;
use timequest_lib::{
    generate_week_plan_impl, GenerateWeekPlanInput, SessionError,
};

fn day_after(days: i64) -> String {
    (Local::now().date_naive() + chrono::Duration::days(days))
        .format("%Y-%m-%d")
        .to_string()
}

async fn insert_task(pool: &SqlitePool, archived: i64) -> i64 {
    let task = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, textbook, unit_name, total_units, total_rounds, current_round, color, archived)
           VALUES ('测试任务', 'main', '数学', '课本A', '节', 40, 1, 1, '#F97316', ?1)"#,
    )
    .bind(archived)
    .execute(pool)
    .await
    .expect("insert task");
    task.last_insert_rowid()
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

fn input(task_id: i64, start: &str, days: i64) -> GenerateWeekPlanInput {
    GenerateWeekPlanInput {
        task_id,
        start_date: Some(start.to_string()),
        days: Some(days),
    }
}

async fn sessions_on(pool: &SqlitePool, task_id: i64) -> Vec<(String, String, String, i64)> {
    sqlx::query_as(
        "SELECT date, start_time, end_time, planned_units FROM task_sessions
         WHERE task_id = ?1 ORDER BY date ASC, start_time ASC",
    )
    .bind(task_id)
    .fetch_all(pool)
    .await
    .expect("select sessions")
}

#[tokio::test]
async fn generate_week_plan_creates_sessions_across_days() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool, 0).await;
    let start = day_after(0);

    let result = generate_week_plan_impl(&pool, input(task_id, &start, 7))
        .await
        .expect("generate plan");

    assert_eq!(result.task_id, task_id);
    assert_eq!(result.created, 21);
    assert_eq!(result.skipped, 0);
    assert_eq!(result.last_date, Some(day_after(6)));

    let rows = sessions_on(&pool, task_id).await;
    assert_eq!(rows.len(), 21);
    // 第一天三段，最后一天三段；每天不超过三场。
    assert_eq!(rows[0].0, day_after(0));
    assert_eq!(rows[0].1, "08:00");
    assert_eq!(rows[1].1, "14:00");
    assert_eq!(rows[2].1, "19:00");
    assert_eq!(rows[20].0, day_after(6));
    assert_eq!(rows[20].2, "20:00");
    assert!(rows.iter().all(|row| row.3 == 1));
}

#[tokio::test]
async fn generate_week_plan_skips_occupied_slots() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool, 0).await;
    let start = day_after(0);

    // 第一天已经有人占了 08:00–09:00。
    let other = insert_task(&pool, 0).await;
    sqlx::query(
        r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, planned_units, status)
           VALUES (?1, ?2, '08:00', '09:00', 1, 1, 'planned')"#,
    )
    .bind(other)
    .bind(&start)
    .execute(&pool)
    .await
    .expect("insert busy session");

    let result = generate_week_plan_impl(&pool, input(task_id, &start, 1))
        .await
        .expect("generate plan");

    assert_eq!(result.created, 2);
    assert_eq!(result.skipped, 1);

    let rows = sessions_on(&pool, task_id).await;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].1, "14:00");
    assert_eq!(rows[1].1, "19:00");
}

#[tokio::test]
async fn generate_week_plan_respects_daily_limit() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool, 0).await;
    let start = day_after(0);
    // 每天只学 1 小时：默认三段里只能排下第一段。
    set_setting(&pool, "daily_limit_minutes", "60").await;

    let result = generate_week_plan_impl(&pool, input(task_id, &start, 3))
        .await
        .expect("generate plan");

    assert_eq!(result.created, 3);
    assert_eq!(result.skipped, 6);

    let rows = sessions_on(&pool, task_id).await;
    assert_eq!(rows.len(), 3);
    assert!(rows.iter().all(|row| row.1 == "08:00"));
    assert_eq!(rows[0].0, day_after(0));
    assert_eq!(rows[2].0, day_after(2));
}

#[tokio::test]
async fn generate_week_plan_uses_configured_slots() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool, 0).await;
    let start = day_after(0);
    set_setting(
        &pool,
        "daily_slots",
        r#"[["20:00","21:00"],["21:30","22:00"]]"#,
    )
    .await;

    let result = generate_week_plan_impl(&pool, input(task_id, &start, 2))
        .await
        .expect("generate plan");

    assert_eq!(result.created, 4);
    let rows = sessions_on(&pool, task_id).await;
    assert_eq!(rows[0].1, "20:00");
    assert_eq!(rows[1].1, "21:30");
    assert_eq!(rows[2].1, "20:00");
}

#[tokio::test]
async fn generate_week_plan_rejects_archived_task() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool, 1).await;
    let start = day_after(0);

    let err = generate_week_plan_impl(&pool, input(task_id, &start, 7))
        .await
        .expect_err("archived task must be rejected");
    assert_eq!(err, SessionError::TaskArchived { task_id });
    assert!(sessions_on(&pool, task_id).await.is_empty());
}

#[tokio::test]
async fn generate_week_plan_rejects_unknown_task() {
    let pool = common::setup().await;
    let start = day_after(0);

    let err = generate_week_plan_impl(&pool, input(999, &start, 7))
        .await
        .expect_err("unknown task must be rejected");
    assert_eq!(err, SessionError::TaskNotFound { task_id: 999 });
}

#[tokio::test]
async fn generate_week_plan_rejects_broken_start_date() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool, 0).await;

    let err = generate_week_plan_impl(&pool, input(task_id, "2026/11/04", 7))
        .await
        .expect_err("broken date must be rejected");
    assert!(matches!(err, SessionError::Message(_)));
    assert!(sessions_on(&pool, task_id).await.is_empty());
}

#[tokio::test]
async fn generate_week_plan_is_idempotent_on_second_run() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool, 0).await;
    let start = day_after(0);

    generate_week_plan_impl(&pool, input(task_id, &start, 3))
        .await
        .expect("first plan");
    let second = generate_week_plan_impl(&pool, input(task_id, &start, 3))
        .await
        .expect("second plan");

    // 第二次没有空位可排：一格都不新建。
    assert_eq!(second.created, 0);
    assert_eq!(second.skipped, 9);
    assert_eq!(sessions_on(&pool, task_id).await.len(), 9);
}