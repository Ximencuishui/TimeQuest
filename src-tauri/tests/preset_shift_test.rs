mod common;

use sqlx::SqlitePool;
use timequest_lib::{
    apply_preset_time_changes_impl, ApplyPresetTimeChangesInput, TimeShiftChange,
};

/// 一个主线任务，供排期挂靠。
async fn insert_task(pool: &SqlitePool) -> i64 {
    let task = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, textbook, unit_name, total_units, total_rounds, current_round, color)
           VALUES ('测试任务', 'main', '数学', '课本A', '课', 40, 2, 1, '#F97316')"#,
    )
    .execute(pool)
    .await
    .expect("insert task");
    task.last_insert_rowid()
}

/// 插一场指定日期/时段/状态的排期。
async fn insert_session(
    pool: &SqlitePool,
    task_id: i64,
    date: &str,
    start: &str,
    end: &str,
    status: &str,
) -> i64 {
    let session = sqlx::query(
        r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, planned_units, status)
           VALUES (?1, ?2, ?3, ?4, 1, 1, ?5)"#,
    )
    .bind(task_id)
    .bind(date)
    .bind(start)
    .bind(end)
    .bind(status)
    .execute(pool)
    .await
    .expect("insert session");
    session.last_insert_rowid()
}

async fn session_times(pool: &SqlitePool, id: i64) -> (String, String) {
    sqlx::query_as::<_, (String, String)>(
        "SELECT start_time, end_time FROM task_sessions WHERE id = ?1",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .expect("read session times")
}

fn change(from: (&str, &str), to: (&str, &str)) -> TimeShiftChange {
    TimeShiftChange {
        from_start: from.0.to_string(),
        from_end: from.1.to_string(),
        to_start: to.0.to_string(),
        to_end: to.1.to_string(),
    }
}

fn input(changes: Vec<TimeShiftChange>, from_date: &str) -> ApplyPresetTimeChangesInput {
    ApplyPresetTimeChangesInput {
        changes,
        from_date: Some(from_date.to_string()),
    }
}

#[tokio::test]
async fn preset_shift_moves_future_planned_sessions() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    let session_id = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "planned").await;

    let result = apply_preset_time_changes_impl(
        &pool,
        input(vec![change(("14:00", "15:00"), ("15:00", "16:00"))], "2026-11-04"),
    )
    .await
    .expect("apply shift");

    assert_eq!(result.matched, 1);
    assert_eq!(result.updated, 1);
    assert_eq!(result.conflicts, 0);
    assert_eq!(
        session_times(&pool, session_id).await,
        ("15:00".to_string(), "16:00".to_string())
    );
}

#[tokio::test]
async fn preset_shift_leaves_history_untouched() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    // 过去的排期：不在 from_date 之后，不动。
    let past = insert_session(&pool, task_id, "2026-11-01", "14:00", "15:00", "planned").await;
    // 已完成的历史：不改写。
    let done = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "done").await;
    // 错过的场次：也不动。
    let missed = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "missed").await;
    // 未来的排期：跟着挪。
    let future = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "planned").await;

    let result = apply_preset_time_changes_impl(
        &pool,
        input(vec![change(("14:00", "15:00"), ("15:00", "16:00"))], "2026-11-04"),
    )
    .await
    .expect("apply shift");

    assert_eq!(result.updated, 1);
    assert_eq!(result.matched, 1);
    assert_eq!(
        session_times(&pool, past).await,
        ("14:00".to_string(), "15:00".to_string())
    );
    assert_eq!(
        session_times(&pool, done).await,
        ("14:00".to_string(), "15:00".to_string())
    );
    assert_eq!(
        session_times(&pool, missed).await,
        ("14:00".to_string(), "15:00".to_string())
    );
    assert_eq!(
        session_times(&pool, future).await,
        ("15:00".to_string(), "16:00".to_string())
    );
}

#[tokio::test]
async fn preset_shift_skips_sessions_that_would_collide() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    // 目标时段已经被占着：挪过去会撞车。
    let busy = insert_session(&pool, task_id, "2026-11-10", "15:00", "16:00", "planned").await;
    let mover = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "planned").await;
    // 另一天没有冲突，照常挪。
    let free = insert_session(&pool, task_id, "2026-11-11", "14:00", "15:00", "planned").await;

    let result = apply_preset_time_changes_impl(
        &pool,
        input(vec![change(("14:00", "15:00"), ("15:00", "16:00"))], "2026-11-04"),
    )
    .await
    .expect("apply shift");

    assert_eq!(result.matched, 2);
    assert_eq!(result.updated, 1);
    assert_eq!(result.conflicts, 1);
    // 撞车的那场保持原样。
    assert_eq!(
        session_times(&pool, mover).await,
        ("14:00".to_string(), "15:00".to_string())
    );
    assert_eq!(
        session_times(&pool, busy).await,
        ("15:00".to_string(), "16:00".to_string())
    );
    assert_eq!(
        session_times(&pool, free).await,
        ("15:00".to_string(), "16:00".to_string())
    );
}

#[tokio::test]
async fn preset_shift_ignores_ambiguous_duplicate_ranges() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    let session_id = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "planned").await;

    // 同一个旧时段被指向两个不同的新时段：不知道该挪到哪，就都不挪。
    let result = apply_preset_time_changes_impl(
        &pool,
        input(
            vec![
                change(("14:00", "15:00"), ("15:00", "16:00")),
                change(("14:00", "15:00"), ("16:00", "17:00")),
            ],
            "2026-11-04",
        ),
    )
    .await
    .expect("apply shift");

    assert_eq!(result.matched, 0);
    assert_eq!(result.updated, 0);
    assert_eq!(result.conflicts, 0);
    assert_eq!(
        session_times(&pool, session_id).await,
        ("14:00".to_string(), "15:00".to_string())
    );
}

#[tokio::test]
async fn preset_shift_without_changes_is_noop() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    let session_id = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "planned").await;

    let result = apply_preset_time_changes_impl(&pool, input(vec![], "2026-11-04"))
        .await
        .expect("apply shift");

    assert_eq!(result.matched, 0);
    assert_eq!(result.updated, 0);
    assert_eq!(result.conflicts, 0);
    assert_eq!(
        session_times(&pool, session_id).await,
        ("14:00".to_string(), "15:00".to_string())
    );
}

#[tokio::test]
async fn preset_shift_ignores_invalid_time_ranges() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    let session_id = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "planned").await;

    // 目标时段结束早于开始：这种改动直接忽略，不碰数据。
    let result = apply_preset_time_changes_impl(
        &pool,
        input(vec![change(("14:00", "15:00"), ("16:00", "15:00"))], "2026-11-04"),
    )
    .await
    .expect("apply shift");

    assert_eq!(result.updated, 0);
    assert_eq!(
        session_times(&pool, session_id).await,
        ("14:00".to_string(), "15:00".to_string())
    );
}

#[tokio::test]
async fn preset_shift_does_not_create_overlaps_when_movers_conflict() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    // 三场连着的排期，其中两场都要挪：
    // 第一场 08:00-09:00 → 09:00-10:00，第二场 09:00-10:00 → 10:00-11:00，
    // 第三场 10:00-11:00 不动。
    let first = insert_session(&pool, task_id, "2026-11-10", "08:00", "09:00", "planned").await;
    let second = insert_session(&pool, task_id, "2026-11-10", "09:00", "10:00", "planned").await;
    let third = insert_session(&pool, task_id, "2026-11-10", "10:00", "11:00", "planned").await;

    let result = apply_preset_time_changes_impl(
        &pool,
        input(
            vec![
                change(("08:00", "09:00"), ("09:00", "10:00")),
                change(("09:00", "10:00"), ("10:00", "11:00")),
            ],
            "2026-11-04",
        ),
    )
    .await
    .expect("apply shift");

    // 挪过去必然撞车：宁可都不挪，也不能造出撞车的计划。
    assert_eq!(result.matched, 2);
    assert_eq!(result.updated, 0);
    assert_eq!(result.conflicts, 2);
    assert_eq!(
        session_times(&pool, first).await,
        ("08:00".to_string(), "09:00".to_string())
    );
    assert_eq!(
        session_times(&pool, second).await,
        ("09:00".to_string(), "10:00".to_string())
    );
    assert_eq!(
        session_times(&pool, third).await,
        ("10:00".to_string(), "11:00".to_string())
    );
}

#[tokio::test]
async fn preset_shift_allows_swapping_two_slots() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    let first = insert_session(&pool, task_id, "2026-11-10", "08:00", "09:00", "planned").await;
    let second = insert_session(&pool, task_id, "2026-11-10", "09:00", "10:00", "planned").await;

    // 两场互换时段：换完之后仍然不撞车，应该都能挪。
    let result = apply_preset_time_changes_impl(
        &pool,
        input(
            vec![
                change(("08:00", "09:00"), ("09:00", "10:00")),
                change(("09:00", "10:00"), ("08:00", "09:00")),
            ],
            "2026-11-04",
        ),
    )
    .await
    .expect("apply shift");

    assert_eq!(result.matched, 2);
    assert_eq!(result.updated, 2);
    assert_eq!(result.conflicts, 0);
    assert_eq!(
        session_times(&pool, first).await,
        ("09:00".to_string(), "10:00".to_string())
    );
    assert_eq!(
        session_times(&pool, second).await,
        ("08:00".to_string(), "09:00".to_string())
    );
}

#[tokio::test]
async fn preset_shift_leaves_rescheduled_sessions_untouched() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    // 改期过的原记录属于历史：不能因为改了设置就把它挪走。
    let rescheduled =
        insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "rescheduled").await;

    let result = apply_preset_time_changes_impl(
        &pool,
        input(vec![change(("14:00", "15:00"), ("15:00", "16:00"))], "2026-11-04"),
    )
    .await
    .expect("apply shift");

    assert_eq!(result.matched, 0);
    assert_eq!(result.updated, 0);
    assert_eq!(result.conflicts, 0);
    assert_eq!(
        session_times(&pool, rescheduled).await,
        ("14:00".to_string(), "15:00".to_string())
    );
}

#[tokio::test]
async fn preset_shift_defaults_to_today_when_from_date_is_missing() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    // 很久以前的一场：不在「今天及以后」，不动。
    let past = insert_session(&pool, task_id, "2020-01-01", "14:00", "15:00", "planned").await;
    // 很久以后的一场：跟着挪。
    let future = insert_session(&pool, task_id, "2099-01-01", "14:00", "15:00", "planned").await;

    let result = apply_preset_time_changes_impl(
        &pool,
        ApplyPresetTimeChangesInput {
            changes: vec![change(("14:00", "15:00"), ("15:00", "16:00"))],
            from_date: None,
        },
    )
    .await
    .expect("apply shift");

    assert_eq!(result.updated, 1);
    assert_eq!(
        session_times(&pool, past).await,
        ("14:00".to_string(), "15:00".to_string())
    );
    assert_eq!(
        session_times(&pool, future).await,
        ("15:00".to_string(), "16:00".to_string())
    );
}