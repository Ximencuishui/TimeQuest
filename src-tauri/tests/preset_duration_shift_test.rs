mod common;

use sqlx::SqlitePool;
use timequest_lib::{
    apply_preset_duration_changes_impl, ApplyPresetDurationChangesInput, DurationShiftChange,
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

fn change(from_minutes: i64, to_minutes: i64) -> DurationShiftChange {
    DurationShiftChange {
        from_minutes,
        to_minutes,
    }
}

fn input(changes: Vec<DurationShiftChange>, from_date: &str) -> ApplyPresetDurationChangesInput {
    ApplyPresetDurationChangesInput {
        changes,
        from_date: Some(from_date.to_string()),
    }
}

#[tokio::test]
async fn preset_duration_shift_moves_future_planned_sessions() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    let session_id = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "planned").await;

    // 60 分钟 → 85 分钟：开始时间不动，结束时间推到 15:25。
    let result =
        apply_preset_duration_changes_impl(&pool, input(vec![change(60, 85)], "2026-11-04"))
            .await
            .expect("apply duration shift");

    assert_eq!(result.matched, 1);
    assert_eq!(result.updated, 1);
    assert_eq!(result.conflicts, 0);
    assert_eq!(
        session_times(&pool, session_id).await,
        ("14:00".to_string(), "15:25".to_string())
    );
}

#[tokio::test]
async fn preset_duration_shift_leaves_history_untouched() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    // 过去的排期：不在 from_date 之后，不动。
    let past = insert_session(&pool, task_id, "2026-11-01", "14:00", "15:00", "planned").await;
    // 已完成的历史：不改写。
    let done = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "done").await;
    // 错过的场次：也不动。
    let missed = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "missed").await;
    // 未来的排期：跟着改。
    let future = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "planned").await;

    let result =
        apply_preset_duration_changes_impl(&pool, input(vec![change(60, 85)], "2026-11-04"))
            .await
            .expect("apply duration shift");

    assert_eq!(result.matched, 1);
    assert_eq!(result.updated, 1);
    assert_eq!(result.conflicts, 0);
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
        ("14:00".to_string(), "15:25".to_string())
    );
}

#[tokio::test]
async fn preset_duration_shift_skips_sessions_that_would_collide() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    // 目标时段已经被占着：改过去会撞车。
    // 这一场是 90 分钟，不在旧时长里，所以它原地不动。
    let busy = insert_session(&pool, task_id, "2026-11-10", "15:00", "16:30", "planned").await;
    let mover = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "planned").await;
    // 另一天没有冲突，照常改。
    let free = insert_session(&pool, task_id, "2026-11-11", "14:00", "15:00", "planned").await;

    let result =
        apply_preset_duration_changes_impl(&pool, input(vec![change(60, 85)], "2026-11-04"))
            .await
            .expect("apply duration shift");

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
        ("15:00".to_string(), "16:30".to_string())
    );
    assert_eq!(
        session_times(&pool, free).await,
        ("14:00".to_string(), "15:25".to_string())
    );
}

#[tokio::test]
async fn preset_duration_shift_ignores_ambiguous_duplicate_durations() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    let session_id = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "planned").await;

    // 同一个旧时长被指向两个不同的新时长：不知道该改成多少，就都不改。
    let result = apply_preset_duration_changes_impl(
        &pool,
        input(vec![change(60, 45), change(60, 90)], "2026-11-04"),
    )
    .await
    .expect("apply duration shift");

    assert_eq!(result.matched, 0);
    assert_eq!(result.updated, 0);
    assert_eq!(result.conflicts, 0);
    assert_eq!(
        session_times(&pool, session_id).await,
        ("14:00".to_string(), "15:00".to_string())
    );
}

#[tokio::test]
async fn preset_duration_shift_without_changes_is_noop() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    let session_id = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "planned").await;

    let result = apply_preset_duration_changes_impl(&pool, input(vec![], "2026-11-04"))
        .await
        .expect("apply duration shift");

    assert_eq!(result.matched, 0);
    assert_eq!(result.updated, 0);
    assert_eq!(result.conflicts, 0);
    assert_eq!(
        session_times(&pool, session_id).await,
        ("14:00".to_string(), "15:00".to_string())
    );
}

#[tokio::test]
async fn preset_duration_shift_ignores_invalid_durations() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    let session_id = insert_session(&pool, task_id, "2026-11-10", "14:00", "15:00", "planned").await;

    // 新时长是 0 分钟：这种改动直接忽略，不碰数据。
    let result =
        apply_preset_duration_changes_impl(&pool, input(vec![change(60, 0)], "2026-11-04"))
            .await
            .expect("apply duration shift");

    assert_eq!(result.updated, 0);
    assert_eq!(
        session_times(&pool, session_id).await,
        ("14:00".to_string(), "15:00".to_string())
    );
}

#[tokio::test]
async fn preset_duration_shift_keeps_sessions_that_would_cross_midnight() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    // 23:00 开场，改成 120 分钟会跨过 23:59：排不进去，保持原样。
    let session_id = insert_session(&pool, task_id, "2026-11-10", "23:00", "23:30", "planned").await;

    let result =
        apply_preset_duration_changes_impl(&pool, input(vec![change(30, 120)], "2026-11-04"))
            .await
            .expect("apply duration shift");

    assert_eq!(result.matched, 1);
    assert_eq!(result.updated, 0);
    assert_eq!(result.conflicts, 1);
    assert_eq!(
        session_times(&pool, session_id).await,
        ("23:00".to_string(), "23:30".to_string())
    );
}

#[tokio::test]
async fn preset_duration_shift_does_not_create_overlaps_when_growing() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    // 两场连着的 60 分钟排期，一起改成 90 分钟：
    // 第一场会往后顶到 09:30，正好压住第二场，不能都改。
    let first = insert_session(&pool, task_id, "2026-11-10", "08:00", "09:00", "planned").await;
    let second = insert_session(&pool, task_id, "2026-11-10", "09:00", "10:00", "planned").await;

    let result =
        apply_preset_duration_changes_impl(&pool, input(vec![change(60, 90)], "2026-11-04"))
            .await
            .expect("apply duration shift");

    assert_eq!(result.matched, 2);
    // 只改后面那一场：它往后延不会压着人，第一场保持原样。
    assert_eq!(result.updated, 1);
    assert_eq!(result.conflicts, 1);
    assert_eq!(
        session_times(&pool, first).await,
        ("08:00".to_string(), "09:00".to_string())
    );
    assert_eq!(
        session_times(&pool, second).await,
        ("09:00".to_string(), "10:30".to_string())
    );
}

#[tokio::test]
async fn preset_duration_shift_defaults_to_today_when_from_date_is_missing() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    // 很久以前的一场：不在「今天及以后」，不动。
    let past = insert_session(&pool, task_id, "2020-01-01", "14:00", "15:00", "planned").await;
    // 很久以后的一场：跟着改。
    let future = insert_session(&pool, task_id, "2099-01-01", "14:00", "15:00", "planned").await;

    let result = apply_preset_duration_changes_impl(
        &pool,
        ApplyPresetDurationChangesInput {
            changes: vec![change(60, 85)],
            from_date: None,
        },
    )
    .await
    .expect("apply duration shift");

    assert_eq!(result.updated, 1);
    assert_eq!(
        session_times(&pool, past).await,
        ("14:00".to_string(), "15:00".to_string())
    );
    assert_eq!(
        session_times(&pool, future).await,
        ("14:00".to_string(), "15:25".to_string())
    );
}