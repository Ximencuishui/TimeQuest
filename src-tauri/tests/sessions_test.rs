mod common;

use chrono::{Local, TimeZone};
use rusqlite::Connection;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::path::PathBuf;
use timequest_lib::{
    advance_round_impl, complete_session_impl, create_session_impl, list_sessions_in_range_impl,
    reschedule_session_impl, task_progress_impl, test_hooks, update_streak_values,
    RemainderSchedule, SessionError, RESCHEDULE_RECOVERY_BONUS,
};

/// Insert a main-line task + planned session; returns `(task_id, session_id)`.
async fn insert_task_and_session(pool: &SqlitePool) -> (i64, i64) {
    insert_task_session(pool, 2, 1).await
}

async fn insert_task_and_session_with_units(pool: &SqlitePool, planned_units: i64) -> (i64, i64) {
    insert_task_session(pool, planned_units, 1).await
}

async fn insert_task_session(pool: &SqlitePool, planned_units: i64, round: i64) -> (i64, i64) {
    let task = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, textbook, unit_name, total_units, total_rounds, current_round, color)
           VALUES ('测试任务', 'main', '数学', '课本A', '课', 40, 2, ?1, '#F97316')"#,
    )
    .bind(round)
    .execute(pool)
    .await
    .expect("insert task");
    let task_id = task.last_insert_rowid();

    let session = sqlx::query(
        r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, planned_units, status)
           VALUES (?1, '2026-11-04', '09:00', '10:00', ?2, ?3, 'planned')"#,
    )
    .bind(task_id)
    .bind(round)
    .bind(planned_units)
    .execute(pool)
    .await
    .expect("insert session");
    let session_id = session.last_insert_rowid();

    (task_id, session_id)
}

async fn insert_session_on_date(
    pool: &SqlitePool,
    task_id: i64,
    date: &str,
    planned_units: i64,
) -> i64 {
    let session = sqlx::query(
        r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, planned_units, status)
           VALUES (?1, ?2, '09:00', '10:00', 1, ?3, 'planned')"#,
    )
    .bind(task_id)
    .bind(date)
    .bind(planned_units)
    .execute(pool)
    .await
    .expect("insert session on date");
    session.last_insert_rowid()
}

/// Smoke: setup + helper compile and run (no business assertions yet).
#[tokio::test]
async fn setup_and_seed_helpers_work() {
    let pool = common::setup().await;
    let (task_id, session_id) = insert_task_and_session(&pool).await;
    assert!(task_id > 0);
    assert!(session_id > 0);

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions WHERE id = ?1")
        .bind(session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn complete_session_is_idempotent() {
    let pool = common::setup().await;
    let (_task_id, session_id) = insert_task_and_session_with_units(&pool, 3).await;

    let xp_before: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();

    let now = Local::now();
    let first = complete_session_impl(&pool, session_id, 3, Some(3), None, false, now, None)
        .await
        .expect("first complete");

    let xp_after_first: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let xp_awarded_first: i64 =
        sqlx::query_scalar("SELECT xp_awarded FROM task_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert!(first.xp_awarded > 0 || xp_awarded_first > 0);
    assert_eq!(xp_after_first, xp_before + xp_awarded_first);

    let second = complete_session_impl(&pool, session_id, 3, Some(3), None, false, now, None)
        .await
        .expect("second complete (idempotent)");

    let log_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs WHERE session_id = ?1")
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(log_count, 1, "actual_logs must not double-insert");

    let xp_awarded_second: i64 =
        sqlx::query_scalar("SELECT xp_awarded FROM task_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        xp_awarded_first, xp_awarded_second,
        "xp_awarded on session must stay stable"
    );
    assert_eq!(second.xp_awarded, 0, "second call awards 0 XP in result");

    let xp_after_second: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        xp_after_second, xp_after_first,
        "user_stats.total_xp must increase only once"
    );

    let status: String = sqlx::query_scalar("SELECT status FROM task_sessions WHERE id = ?1")
        .bind(session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "done");
}

#[tokio::test]
async fn partial_completion_spawns_remainder_session() {
    let pool = common::setup().await;
    let (task_id, session_id) = insert_task_session(&pool, 5, 2).await;

    let rem_date = "2026-11-05".to_string();
    let rem_start = "14:00".to_string();
    let rem_end = "15:30".to_string();

    let result = complete_session_impl(
        &pool,
        session_id,
        3,
        Some(4),
        None,
        true,
        Local::now(),
        Some(RemainderSchedule {
            date: rem_date.clone(),
            start_time: rem_start.clone(),
            end_time: rem_end.clone(),
        }),
    )
    .await
    .expect("partial complete with remainder");

    let orig: (String, i64) =
        sqlx::query_as("SELECT status, actual_units FROM task_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(orig.0, "done");
    assert_eq!(orig.1, 3);

    let rem_id = result
        .remainder_session_id
        .expect("remainder_session_id must be set");
    assert_eq!(result.created_session_id, Some(rem_id));

    let rem: (String, i64, i64, i64, String, String, String) = sqlx::query_as(
        r#"SELECT status, planned_units, round, task_id, date, start_time, end_time
           FROM task_sessions WHERE id = ?1"#,
    )
    .bind(rem_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(rem.0, "planned");
    assert_eq!(rem.1, 2);
    assert_eq!(rem.2, 2);
    assert_eq!(rem.3, task_id);
    assert_eq!(rem.4, rem_date);
    assert_eq!(rem.5, rem_start);
    assert_eq!(rem.6, rem_end);
}

#[tokio::test]
async fn rescheduled_then_completed_gets_recovery_bonus_once() {
    let pool = common::setup().await;
    let (_task_id, session_a) = insert_task_and_session_with_units(&pool, 2).await;

    let now = Local::now();
    let reschedule = reschedule_session_impl(
        &pool,
        session_a,
        "2026-11-06".into(),
        "16:00".into(),
        "17:00".into(),
        now,
    )
    .await
    .expect("reschedule A -> B");

    let session_b = reschedule
        .created_session_id
        .expect("reschedule must create session B");

    let a_row: (String, Option<i64>) =
        sqlx::query_as("SELECT status, rescheduled_to FROM task_sessions WHERE id = ?1")
            .bind(session_a)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(a_row.0, "rescheduled");
    assert_eq!(a_row.1, Some(session_b));

    let xp_before: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();

    let first = complete_session_impl(&pool, session_b, 2, Some(4), None, false, now, None)
        .await
        .expect("complete B first time");

    assert!(
        first.xp_awarded >= RESCHEDULE_RECOVERY_BONUS,
        "first complete of rescheduled target must include recovery bonus"
    );
    // base XP for main / 2 units / rating 4 / streak 0 = round(2*12*1.2)=29; plus bonus 5.
    // rating 3 no longer receives the bonus (same guard as comeback).
    let expected_total_award = first.xp_awarded;
    assert_eq!(
        expected_total_award,
        29 + RESCHEDULE_RECOVERY_BONUS,
        "XP should be base session XP + recovery bonus once"
    );

    let xp_after_first: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(xp_after_first, xp_before + expected_total_award);

    let second = complete_session_impl(&pool, session_b, 2, Some(3), None, false, now, None)
        .await
        .expect("complete B second time (idempotent)");
    assert_eq!(second.xp_awarded, 0);

    let b_status: String = sqlx::query_scalar("SELECT status FROM task_sessions WHERE id = ?1")
        .bind(session_b)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(b_status, "done");

    let log_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs WHERE session_id = ?1")
            .bind(session_b)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(log_count, 1);

    let logs_for_a: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs WHERE session_id = ?1")
            .bind(session_a)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(logs_for_a, 0);

    let xp_after_second: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        xp_after_second, xp_after_first,
        "recovery bonus / XP must not be applied twice"
    );
    // Explicit: only one bonus worth of XP beyond base was ever granted
    assert_eq!(xp_after_second - xp_before - 29, RESCHEDULE_RECOVERY_BONUS);

    let a_after: (String, Option<i64>, i64, i64) = sqlx::query_as(
        "SELECT status, rescheduled_to, actual_units, xp_awarded FROM task_sessions WHERE id = ?1",
    )
    .bind(session_a)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(a_after.0, "rescheduled");
    assert_eq!(a_after.1, Some(session_b));
    assert_eq!(a_after.2, 0);
    assert_eq!(a_after.3, 0);
}

#[tokio::test]
async fn completion_rolls_back_on_log_insert_failure() {
    let pool = common::setup().await;
    let (_task_id, session_id) = insert_task_and_session_with_units(&pool, 3).await;

    let xp_before: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let logs_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs")
        .fetch_one(&pool)
        .await
        .unwrap();

    test_hooks::set_fail_actual_log_insert(true);
    let err = complete_session_impl(
        &pool,
        session_id,
        3,
        Some(3),
        None,
        false,
        Local::now(),
        None,
    )
    .await;
    test_hooks::set_fail_actual_log_insert(false);

    assert!(
        err.is_err(),
        "complete must return Err when log insert is injected"
    );
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("inject: actual_logs"),
        "unexpected error: {msg}"
    );

    let status: String = sqlx::query_scalar("SELECT status FROM task_sessions WHERE id = ?1")
        .bind(session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "planned", "session must roll back to planned");

    let xp_after: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        xp_after, xp_before,
        "XP must not increase on failed complete"
    );

    let logs_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        logs_after, logs_before,
        "no actual_logs row should be added"
    );
}

#[tokio::test]
async fn completion_with_zero_units_awards_no_xp() {
    // Policy: actual_units=0 is allowed → session becomes `done` with xp_awarded=0.
    // High self_rating must not mint XP (calc_session_xp short-circuits on units<=0).
    let pool = common::setup().await;
    let (_task_id, session_id) = insert_task_and_session_with_units(&pool, 3).await;

    let xp_before: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();

    let result = complete_session_impl(
        &pool,
        session_id,
        0,
        Some(5),
        None,
        false,
        Local::now(),
        None,
    )
    .await
    .expect("zero-unit complete is allowed as Ok(done, 0 XP)");

    assert_eq!(result.xp_awarded, 0);
    assert_eq!(result.session.status, "done");
    assert_eq!(result.session.actual_units, 0);
    assert_eq!(result.session.xp_awarded, 0);
    assert_eq!(result.session.self_rating, Some(5));

    let xp_after: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(xp_after, xp_before, "total_xp must not change");

    let logs: Vec<(i64,)> =
        sqlx::query_as("SELECT duration_min FROM actual_logs WHERE session_id = ?1")
            .bind(session_id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(logs.len() <= 1, "at most one actual_log");
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].0, 0, "duration_min must be 0 when actual_units=0");
}

#[tokio::test]
async fn complete_session_rejects_zero_units_with_defer() {
    // A 段：拒绝须在 begin() 之前，不写 actual_logs / 不 spawn / 不改 XP。
    let pool = common::setup().await;
    let (_task_id, session_id) = insert_task_and_session_with_units(&pool, 5).await;

    let xp_before: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let streak_before: i64 =
        sqlx::query_scalar("SELECT current_streak FROM user_stats WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    let logs_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs")
        .fetch_one(&pool)
        .await
        .unwrap();
    let sessions_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();

    let err = complete_session_impl(
        &pool,
        session_id,
        0,
        Some(3),
        None,
        true,
        Local::now(),
        Some(RemainderSchedule {
            date: "2026-11-05".into(),
            start_time: "19:00".into(),
            end_time: "20:00".into(),
        }),
    )
    .await
    .expect_err("actual_units=0 + move_remainder must Err");

    assert_eq!(err, SessionError::ZeroUnitsCannotDefer);

    let status_units: (String, i64) =
        sqlx::query_as("SELECT status, COALESCE(actual_units, 0) FROM task_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status_units.0, "planned");
    assert_eq!(status_units.1, 0);

    let logs_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(logs_after, logs_before, "must not insert actual_logs");

    let sessions_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        sessions_after, sessions_before,
        "must not spawn remainder session"
    );

    let xp_after: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let streak_after: i64 =
        sqlx::query_scalar("SELECT current_streak FROM user_stats WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(xp_after, xp_before);
    assert_eq!(streak_after, streak_before);
}

#[tokio::test]
async fn complete_session_zero_units_without_defer_still_succeeds() {
    let pool = common::setup().await;
    let (_task_id, session_id) = insert_task_and_session_with_units(&pool, 5).await;

    let xp_before: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let streak_before: i64 =
        sqlx::query_scalar("SELECT current_streak FROM user_stats WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();

    let result = complete_session_impl(
        &pool,
        session_id,
        0,
        Some(3),
        None,
        false,
        Local::now(),
        None,
    )
    .await
    .expect("actual_units=0 without defer must still Ok");

    assert_eq!(result.session.status, "done");
    assert_eq!(result.session.actual_units, 0);

    let logs: Vec<(i64,)> =
        sqlx::query_as("SELECT duration_min FROM actual_logs WHERE session_id = ?1")
            .bind(session_id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].0, 0);

    let xp_after: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let streak_after: i64 =
        sqlx::query_scalar("SELECT current_streak FROM user_stats WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(xp_after, xp_before);
    assert_eq!(streak_after, streak_before);
}

#[tokio::test]
async fn complete_session_positive_units_with_defer_still_succeeds() {
    let pool = common::setup().await;
    let (task_id, session_id) = insert_task_and_session_with_units(&pool, 5).await;

    let result = complete_session_impl(
        &pool,
        session_id,
        2,
        Some(4),
        None,
        true,
        Local::now(),
        Some(RemainderSchedule {
            date: "2026-11-05".into(),
            start_time: "14:00".into(),
            end_time: "15:00".into(),
        }),
    )
    .await
    .expect("partial complete with defer must Ok");

    let orig: (String, i64) =
        sqlx::query_as("SELECT status, actual_units FROM task_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(orig.0, "done");
    assert_eq!(orig.1, 2);

    let rem_id = result
        .remainder_session_id
        .expect("remainder_session_id must be set");
    let rem_planned: i64 =
        sqlx::query_scalar("SELECT planned_units FROM task_sessions WHERE id = ?1")
            .bind(rem_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(rem_planned, 3);

    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions WHERE task_id = ?1")
        .bind(task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 2);
}

#[tokio::test]
async fn complete_session_with_zero_planned_and_zero_actual_no_spawn() {
    // 政策升级：actual=0 + move_remainder 一律 ZeroUnitsCannotDefer（含 planned=0）。
    // 不再走到 remaining<=0 的「静默不 spawn」分支。
    let pool = common::setup().await;
    let (task_id, session_id) = insert_task_and_session_with_units(&pool, 0).await;

    let sessions_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions WHERE task_id = ?1")
            .bind(task_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(sessions_before, 1);

    let err = complete_session_impl(
        &pool,
        session_id,
        0,
        Some(3),
        None,
        true,
        Local::now(),
        Some(RemainderSchedule {
            date: "2026-11-05".into(),
            start_time: "19:00".into(),
            end_time: "20:00".into(),
        }),
    )
    .await
    .expect_err("zero actual + defer must Err before spawn logic");

    assert_eq!(err, SessionError::ZeroUnitsCannotDefer);

    let sessions_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions WHERE task_id = ?1")
            .bind(task_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(sessions_after, 1, "must not spawn any remainder");

    let orig: (String, i64) =
        sqlx::query_as("SELECT status, COALESCE(actual_units, 0) FROM task_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(orig.0, "planned");
    assert_eq!(orig.1, 0);
}

#[tokio::test]
async fn streak_across_midnight_uses_local_date() {
    // Streak is updated in Rust (`complete_session_impl` → `update_streak_values`)
    // using `session.date` (local calendar day), not the frontend.
    // `now` is fixed at local 23:59 / 00:01 to mirror a midnight crossing;
    // consecutive session dates are what advance the streak.
    let pool = common::setup().await;
    let (task_id, session_a) = insert_task_session(&pool, 1, 1).await;
    // rewrite A's date explicitly for clarity
    sqlx::query("UPDATE task_sessions SET date = '2026-11-04', start_time = '23:00', end_time = '23:50' WHERE id = ?1")
        .bind(session_a)
        .execute(&pool)
        .await
        .unwrap();

    let session_b = insert_session_on_date(&pool, task_id, "2026-11-05", 1).await;
    sqlx::query("UPDATE task_sessions SET start_time = '00:01', end_time = '00:30' WHERE id = ?1")
        .bind(session_b)
        .execute(&pool)
        .await
        .unwrap();

    let now_late = Local
        .with_ymd_and_hms(2026, 11, 4, 23, 59, 0)
        .single()
        .expect("local 23:59");
    complete_session_impl(&pool, session_a, 1, Some(3), None, false, now_late, None)
        .await
        .expect("complete A before midnight");

    let streak_after_a: (i64, i64, Option<String>) = sqlx::query_as(
        "SELECT current_streak, longest_streak, last_done_date FROM user_stats WHERE id = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(streak_after_a.0, 1);
    assert_eq!(streak_after_a.1, 1);
    assert_eq!(streak_after_a.2.as_deref(), Some("2026-11-04"));

    let now_early = Local
        .with_ymd_and_hms(2026, 11, 5, 0, 1, 0)
        .single()
        .expect("local 00:01");
    complete_session_impl(&pool, session_b, 1, Some(3), None, false, now_early, None)
        .await
        .expect("complete B just after midnight");

    let streak_after_b: (i64, i64, Option<String>) = sqlx::query_as(
        "SELECT current_streak, longest_streak, last_done_date FROM user_stats WHERE id = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        streak_after_b.0, 2,
        "adjacent local dates must continue streak (not reset at wall-clock midnight)"
    );
    assert_eq!(streak_after_b.1, 2);
    assert_eq!(streak_after_b.2.as_deref(), Some("2026-11-05"));

    // Gap day (skip 2026-11-06) → reset current, keep longest
    let session_c = insert_session_on_date(&pool, task_id, "2026-11-07", 1).await;
    let now_gap = Local
        .with_ymd_and_hms(2026, 11, 7, 10, 0, 0)
        .single()
        .expect("local gap day");
    complete_session_impl(&pool, session_c, 1, Some(3), None, false, now_gap, None)
        .await
        .expect("complete C after a gap");

    let streak_after_gap: (i64, i64, Option<String>) = sqlx::query_as(
        "SELECT current_streak, longest_streak, last_done_date FROM user_stats WHERE id = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(streak_after_gap.0, 1, "gap resets current_streak to 1");
    assert_eq!(
        streak_after_gap.1, 2,
        "longest_streak must be preserved across reset"
    );
    assert_eq!(streak_after_gap.2.as_deref(), Some("2026-11-07"));
}

#[tokio::test]
async fn earlier_date_after_last_done_keeps_streak() {
    // Streak uses session.date (not wall-clock `now`). Completing an earlier
    // calendar day after a later one must still award XP, but must not bump
    // streak or rewind last_done_date (update_streak_values diff < 0 branch).
    let pool = common::setup().await;
    let (task_id, session_a) = insert_task_session(&pool, 3, 1).await;
    // D+1
    sqlx::query(
        "UPDATE task_sessions SET date = '2026-11-05', start_time = '10:00', end_time = '11:00' WHERE id = ?1",
    )
    .bind(session_a)
    .execute(&pool)
    .await
    .unwrap();

    let session_b = insert_session_on_date(&pool, task_id, "2026-11-04", 3).await;
    // D (earlier than A); distinct slot
    sqlx::query("UPDATE task_sessions SET start_time = '09:00', end_time = '10:00' WHERE id = ?1")
        .bind(session_b)
        .execute(&pool)
        .await
        .unwrap();

    let now = Local
        .with_ymd_and_hms(2026, 11, 5, 12, 0, 0)
        .single()
        .expect("fixed local noon");

    let result_a = complete_session_impl(&pool, session_a, 3, Some(5), None, false, now, None)
        .await
        .expect("complete A on D+1");

    let xp_a = result_a.xp_awarded;
    assert!(xp_a > 0, "A must award XP");

    let after_a: (i64, i64, Option<String>, i64) = sqlx::query_as(
        "SELECT current_streak, longest_streak, last_done_date, total_xp FROM user_stats WHERE id = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(after_a.0, 1);
    assert_eq!(after_a.1, 1);
    assert_eq!(after_a.2.as_deref(), Some("2026-11-05"));
    assert_eq!(after_a.3, xp_a);

    let xp_before_b = after_a.3;
    let result_b = complete_session_impl(&pool, session_b, 3, Some(5), None, false, now, None)
        .await
        .expect("complete B on earlier day D");

    assert_eq!(result_b.session.status, "done");
    let xp_b = result_b.xp_awarded;
    assert!(xp_b > 0, "B must still award XP out of order");

    let after_b: (i64, i64, Option<String>, i64) = sqlx::query_as(
        "SELECT current_streak, longest_streak, last_done_date, total_xp FROM user_stats WHERE id = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        after_b.3,
        xp_before_b + xp_b,
        "XP must increase even when done_date < last_done_date"
    );
    assert_eq!(
        after_b.0, 1,
        "out-of-order earlier day must not bump current_streak to 2"
    );
    assert_eq!(after_b.1, 1, "longest_streak must stay 1");
    assert_eq!(
        after_b.2.as_deref(),
        Some("2026-11-05"),
        "last_done_date must stay on D+1, not rewind to D"
    );

    // Extra: unparseable done_date — current semantics (documented):
    // parse failure falls through to next=1 and replaces last_done with done_date
    // (does NOT keep prior last_done). Chosen over "keep" to match today's code;
    // not treated as diff < 0 (which would preserve streak + last).
    let (cur, longest, last) = update_streak_values(4, 6, Some("2026-11-05"), "not-a-date");
    assert_eq!(cur, 1, "parse failure resets current_streak to 1");
    assert_eq!(longest, 6, "longest_streak preserved via max");
    assert_eq!(
        last, "not-a-date",
        "parse failure overwrites last_done_date with the unparseable done_date"
    );
}

#[tokio::test]
async fn create_session_rejects_archived_task() {
    let pool = common::setup().await;

    let archived = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round, archived)
           VALUES ('归档任务', 'main', '数学', '课', 40, 1, 1, 1)"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let archived_id = archived.last_insert_rowid();

    let active = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round, archived)
           VALUES ('活跃任务', 'main', '英语', '课', 40, 1, 1, 0)"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let active_id = active.last_insert_rowid();

    let err = create_session_impl(
        &pool,
        archived_id,
        "2026-11-08".into(),
        "09:00".into(),
        "10:00".into(),
        None,
        Some(2),
    )
    .await
    .expect_err("archived task must be rejected");

    assert!(
        matches!(
            err,
            SessionError::TaskArchived { task_id } if task_id == archived_id
        ),
        "expected TaskArchived {{ task_id: {archived_id} }}, got {err:?}"
    );

    let ok = create_session_impl(
        &pool,
        active_id,
        "2026-11-08".into(),
        "10:00".into(),
        "11:00".into(),
        None,
        Some(2),
    )
    .await
    .expect("active task must allow create_session");

    assert_eq!(ok.task_id, active_id);
    assert_eq!(ok.status, "planned");
    assert_eq!(ok.planned_units, 2);

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions WHERE id = ?1 AND task_id = ?2")
            .bind(ok.id)
            .bind(active_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn create_session_defaults_round_to_task_current_round() {
    let pool = common::setup().await;

    let task = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round, archived)
           VALUES ('轮次任务', 'main', '物理', '课', 40, 3, 1, 0)"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let task_id = task.last_insert_rowid();

    let s1 = create_session_impl(
        &pool,
        task_id,
        "2026-11-08".into(),
        "09:00".into(),
        "10:00".into(),
        None,
        Some(1),
    )
    .await
    .expect("create with default round");
    assert_eq!(s1.round, 1);

    let advanced = advance_round_impl(&pool, task_id)
        .await
        .expect("advance to round 2");
    assert_eq!(advanced.current_round, 2);

    let s2 = create_session_impl(
        &pool,
        task_id,
        "2026-11-09".into(),
        "09:00".into(),
        "10:00".into(),
        None,
        Some(1),
    )
    .await
    .expect("create after advance");
    assert_eq!(s2.round, 2);

    let s3 = create_session_impl(
        &pool,
        task_id,
        "2026-11-10".into(),
        "09:00".into(),
        "10:00".into(),
        Some(1),
        Some(1),
    )
    .await
    .expect("explicit round=1");
    assert_eq!(s3.round, 1);

    let current: i64 = sqlx::query_scalar("SELECT current_round FROM tasks WHERE id = ?1")
        .bind(task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        current, 2,
        "explicit session round must not roll back task.current_round"
    );
}

#[tokio::test]
async fn advance_round_increments_and_respects_total_rounds() {
    // Current semantics: advance_round always does current_round += 1 with NO cap
    // against total_rounds and does NOT error at the ceiling. Documented here so a
    // future clamp/error change must update this test deliberately.
    let pool = common::setup().await;

    let task = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round, archived)
           VALUES ('封顶任务', 'main', '化学', '课', 10, 2, 1, 0)"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let task_id = task.last_insert_rowid();

    let t1 = advance_round_impl(&pool, task_id).await.unwrap();
    assert_eq!(t1.current_round, 2);
    assert_eq!(t1.total_rounds, 2);

    // At current_round == total_rounds: still increments (unbounded).
    let t2 = advance_round_impl(&pool, task_id).await.unwrap();
    assert_eq!(
        t2.current_round, 3,
        "past total_rounds: implementation keeps incrementing (no error, no clamp)"
    );
    assert_eq!(t2.total_rounds, 2);
}

#[tokio::test]
async fn reschedule_done_session_fails() {
    let pool = common::setup().await;
    let (_task_id, session_id) = insert_task_and_session(&pool).await;

    sqlx::query("UPDATE task_sessions SET status = 'done' WHERE id = ?1")
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();

    let now = Local::now();
    let err = reschedule_session_impl(
        &pool,
        session_id,
        "2026-11-10".into(),
        "14:00".into(),
        "15:00".into(),
        now,
    )
    .await
    .expect_err("done session must not reschedule");

    let msg = err.to_string();
    assert!(
        msg.contains("cannot reschedule status done"),
        "expected status-done rejection, got: {msg}"
    );

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1, "failed reschedule must not insert a new session");
}

#[tokio::test]
async fn reschedule_missed_session_fails() {
    let pool = common::setup().await;
    let (_task_id, session_id) = insert_task_and_session(&pool).await;

    sqlx::query("UPDATE task_sessions SET status = 'missed' WHERE id = ?1")
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();

    let now = Local::now();
    let err = reschedule_session_impl(
        &pool,
        session_id,
        "2026-11-10".into(),
        "14:00".into(),
        "15:00".into(),
        now,
    )
    .await
    .expect_err("missed session must not reschedule");

    let msg = err.to_string();
    assert!(
        msg.contains("cannot reschedule status missed"),
        "expected status-missed rejection, got: {msg}"
    );

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1, "failed reschedule must not insert a new session");
}

#[tokio::test]
async fn reschedule_already_rescheduled_is_idempotent() {
    // Current semantics: status == 'rescheduled' short-circuits to Ok, returning the
    // existing `rescheduled_to` as `created_session_id` without inserting another row.
    // (Not Err — re-entry is treated as idempotent success.)
    let pool = common::setup().await;
    let (_task_id, session_a) = insert_task_and_session(&pool).await;

    let now = Local::now();
    let first = reschedule_session_impl(
        &pool,
        session_a,
        "2026-11-10".into(),
        "16:00".into(),
        "17:00".into(),
        now,
    )
    .await
    .expect("first reschedule");
    let session_b = first
        .created_session_id
        .expect("first reschedule creates target");

    let count_after_first: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count_after_first, 2);

    let second = reschedule_session_impl(
        &pool,
        session_a,
        "2026-11-11".into(),
        "18:00".into(),
        "19:00".into(),
        now,
    )
    .await
    .expect("second reschedule is Ok (idempotent)");

    assert_eq!(
        second.created_session_id,
        Some(session_b),
        "must return existing rescheduled_to, not a new id"
    );
    assert_eq!(second.session.status, "rescheduled");
    assert_eq!(second.session.rescheduled_to, Some(session_b));
    assert_eq!(second.xp_awarded, 0);

    let count_after_second: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        count_after_second, 2,
        "idempotent reschedule must not create another session"
    );

    let a_to: Option<i64> =
        sqlx::query_scalar("SELECT rescheduled_to FROM task_sessions WHERE id = ?1")
            .bind(session_a)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(a_to, Some(session_b));
}

#[tokio::test]
async fn complete_rescheduled_or_missed_session_rejected() {
    let pool = common::setup().await;
    let now = Local::now();

    // --- Scenario A: cannot complete a rescheduled source session ---
    let (_task_id, session_a) = insert_task_and_session_with_units(&pool, 3).await;
    let reschedule = reschedule_session_impl(
        &pool,
        session_a,
        "2026-11-06".into(),
        "16:00".into(),
        "17:00".into(),
        now,
    )
    .await
    .expect("reschedule A -> B");
    let session_b = reschedule
        .created_session_id
        .expect("reschedule must create session B");

    let a_before: (String, Option<i64>, i64) = sqlx::query_as(
        "SELECT status, rescheduled_to, actual_units FROM task_sessions WHERE id = ?1",
    )
    .bind(session_a)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(a_before.0, "rescheduled");
    assert_eq!(a_before.1, Some(session_b));
    assert_eq!(a_before.2, 0);

    let xp_before_a: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let streak_before_a: i64 =
        sqlx::query_scalar("SELECT current_streak FROM user_stats WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    let logs_before_a: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs")
        .fetch_one(&pool)
        .await
        .unwrap();

    let err_a = complete_session_impl(&pool, session_a, 3, Some(5), None, false, now, None)
        .await
        .expect_err("completing rescheduled source must fail");

    assert!(
        matches!(
            err_a,
            SessionError::InvalidCompleteStatus { ref status } if status == "rescheduled"
        ),
        "expected InvalidCompleteStatus {{ status: rescheduled }}, got {err_a:?}"
    );

    let a_after: (String, i64) =
        sqlx::query_as("SELECT status, actual_units FROM task_sessions WHERE id = ?1")
            .bind(session_a)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(a_after.0, "rescheduled");
    assert_eq!(a_after.1, 0);

    let xp_after_a: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(xp_after_a, xp_before_a);
    let streak_after_a: i64 =
        sqlx::query_scalar("SELECT current_streak FROM user_stats WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(streak_after_a, streak_before_a);
    let logs_after_a: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(logs_after_a, logs_before_a);

    // --- Scenario B: cannot complete a missed session ---
    let (_task_c, session_c) = insert_task_and_session_with_units(&pool, 3).await;
    sqlx::query("UPDATE task_sessions SET status = 'missed' WHERE id = ?1")
        .bind(session_c)
        .execute(&pool)
        .await
        .unwrap();

    let xp_before_c: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let logs_before_c: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs")
        .fetch_one(&pool)
        .await
        .unwrap();

    let err_c = complete_session_impl(&pool, session_c, 3, Some(5), None, false, now, None)
        .await
        .expect_err("completing missed session must fail");

    assert!(
        matches!(
            err_c,
            SessionError::InvalidCompleteStatus { ref status } if status == "missed"
        ),
        "expected InvalidCompleteStatus {{ status: missed }}, got {err_c:?}"
    );

    let c_after: (String, i64) =
        sqlx::query_as("SELECT status, actual_units FROM task_sessions WHERE id = ?1")
            .bind(session_c)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(c_after.0, "missed");
    assert_eq!(c_after.1, 0);

    let xp_after_c: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(xp_after_c, xp_before_c);
    let logs_after_c: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(logs_after_c, logs_before_c);

    // --- Scenario C: reschedule target B completes once (idempotent) ---
    let first_b = complete_session_impl(&pool, session_b, 3, Some(5), None, false, now, None)
        .await
        .expect("first complete of B");
    assert_eq!(first_b.session.status, "done");

    let xp_awarded_first: i64 =
        sqlx::query_scalar("SELECT xp_awarded FROM task_sessions WHERE id = ?1")
            .bind(session_b)
            .fetch_one(&pool)
            .await
            .unwrap();

    let second_b = complete_session_impl(&pool, session_b, 3, Some(5), None, false, now, None)
        .await
        .expect("second complete of B is idempotent Ok");

    let b_status: String = sqlx::query_scalar("SELECT status FROM task_sessions WHERE id = ?1")
        .bind(session_b)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(b_status, "done");

    let logs_b: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs WHERE session_id = ?1")
        .bind(session_b)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(logs_b, 1);

    let xp_awarded_second: i64 =
        sqlx::query_scalar("SELECT xp_awarded FROM task_sessions WHERE id = ?1")
            .bind(session_b)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(xp_awarded_first, xp_awarded_second);
    assert_eq!(second_b.xp_awarded, 0);
}

#[tokio::test]
async fn negative_actual_units_do_not_corrupt_progress() {
    let pool = common::setup().await;
    // total_units=40, current_round=1; planned_units=5, status=planned, round=1
    let (task_id, session_id) = insert_task_session(&pool, 5, 1).await;

    let progress_before: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(actual_units),0) FROM task_sessions WHERE task_id = ?1 AND round = 1",
    )
    .bind(task_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let stats_before: (i64, i64, i64) = sqlx::query_as(
        "SELECT total_xp, current_streak, longest_streak FROM user_stats WHERE id = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let logs_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs")
        .fetch_one(&pool)
        .await
        .unwrap();

    let sessions_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions WHERE task_id = ?1")
            .bind(task_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    let err = complete_session_impl(
        &pool,
        session_id,
        -2,
        Some(5),
        None,
        true,
        Local::now(),
        Some(RemainderSchedule {
            date: "2026-11-05".into(),
            start_time: "14:00".into(),
            end_time: "15:00".into(),
        }),
    )
    .await
    .expect_err("negative actual_units must be rejected");

    assert!(
        matches!(err, SessionError::InvalidActualUnits { actual_units: -2 }),
        "expected InvalidActualUnits {{ actual_units: -2 }}, got {err:?}"
    );

    let sess: (String, i64) =
        sqlx::query_as("SELECT status, actual_units FROM task_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(sess.0, "planned");
    assert_eq!(sess.1, 0);

    let progress_after: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(actual_units),0) FROM task_sessions WHERE task_id = ?1 AND round = 1",
    )
    .bind(task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        progress_after, progress_before,
        "round progress must not drop on rejected complete"
    );

    let stats_after: (i64, i64, i64) = sqlx::query_as(
        "SELECT total_xp, current_streak, longest_streak FROM user_stats WHERE id = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        stats_after.0, stats_before.0,
        "total_xp must stay unchanged"
    );
    assert_eq!(
        stats_after.1, stats_before.1,
        "current_streak must stay unchanged"
    );
    assert_eq!(
        stats_after.2, stats_before.2,
        "longest_streak must stay unchanged"
    );

    let logs_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(logs_after, logs_before, "actual_logs must not grow");

    let sessions_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions WHERE task_id = ?1")
            .bind(task_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    // Preferred: reject before any write → no remainder session.
    // Fallback (h): if a remainder were ever allowed, its planned_units must not
    // exceed the original planned_units (5 − (−2) = 7 would be a corruption).
    if sessions_after == sessions_before {
        // ok — no remainder spawned
    } else {
        assert_eq!(
            sessions_after,
            sessions_before + 1,
            "at most one remainder session"
        );
        let rem_planned: i64 = sqlx::query_scalar(
            "SELECT planned_units FROM task_sessions WHERE task_id = ?1 AND id != ?2",
        )
        .bind(task_id)
        .bind(session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(
            rem_planned <= 5,
            "remainder planned_units ({rem_planned}) must not exceed original planned_units (5)"
        );
        let orig_planned: i64 =
            sqlx::query_scalar("SELECT planned_units FROM task_sessions WHERE id = ?1")
                .bind(session_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            orig_planned, 5,
            "original planned_units must not be inflated"
        );
    }
}

#[tokio::test]
async fn second_completion_same_day_keeps_streak() {
    let pool = common::setup().await;
    let (task_id, session_a) = insert_task_and_session_with_units(&pool, 1).await;
    let session_b = insert_session_on_date(&pool, task_id, "2026-11-04", 1).await;
    // distinct slot so both rows stay valid planned sessions on the same local date
    sqlx::query("UPDATE task_sessions SET start_time = '11:00', end_time = '12:00' WHERE id = ?1")
        .bind(session_b)
        .execute(&pool)
        .await
        .unwrap();

    let now = Local
        .with_ymd_and_hms(2026, 11, 4, 12, 0, 0)
        .single()
        .expect("local noon");

    complete_session_impl(&pool, session_a, 1, Some(3), None, false, now, None)
        .await
        .expect("complete first session of the day");

    let after_first: (i64, i64, Option<String>) = sqlx::query_as(
        "SELECT current_streak, longest_streak, last_done_date FROM user_stats WHERE id = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(after_first.0, 1);
    assert_eq!(after_first.1, 1);
    assert_eq!(after_first.2.as_deref(), Some("2026-11-04"));

    complete_session_impl(&pool, session_b, 1, Some(3), None, false, now, None)
        .await
        .expect("complete second session same day");

    let after_second: (i64, i64, Option<String>) = sqlx::query_as(
        "SELECT current_streak, longest_streak, last_done_date FROM user_stats WHERE id = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        after_second.0, 1,
        "same-day second complete must keep current_streak at 1"
    );
    assert_eq!(
        after_second.1, 1,
        "same-day second complete must not bump longest_streak"
    );
    assert_eq!(
        after_second.2.as_deref(),
        Some("2026-11-04"),
        "last_done_date must stay on the same local day"
    );
}

/// 超额完成：`actual_units` 可以大于 `planned_units`，XP 按实际单位，不生成负数剩余场次。
#[tokio::test]
async fn complete_allows_actual_units_above_planned_and_awards_full_xp() {
    let pool = common::setup().await;
    let task_id = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round)
           VALUES ('超额完成', 'main', '数学', '课', 20, 1, 1)"#,
    )
    .execute(&pool)
    .await
    .expect("insert task")
    .last_insert_rowid();
    let session_id = sqlx::query(
        r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, planned_units, status)
           VALUES (?1, '2026-11-04', '09:00', '10:00', 1, 3, 'planned')"#,
    )
    .bind(task_id)
    .execute(&pool)
    .await
    .expect("insert session")
    .last_insert_rowid();

    let xp_before: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();

    // move_remainder=true 才会走到 remaining 分支；3-5=-2 不得 spawn。
    let result = complete_session_impl(
        &pool,
        session_id,
        5,
        Some(4),
        None,
        true,
        Local::now(),
        None,
    )
    .await
    .expect("actual_units above planned_units must be Ok");

    assert_eq!(result.session.status, "done");
    assert_eq!(
        result.session.actual_units, 5,
        "a. returned actual_units stays 5, not clamped to planned 3"
    );
    assert_eq!(result.created_session_id, None);
    assert_eq!(result.remainder_session_id, None);

    let stored: (String, i64) =
        sqlx::query_as("SELECT status, actual_units FROM task_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored.0, "done");
    assert_eq!(stored.1, 5, "a. stored actual_units stays 5");

    // main / 5 单位 / 自评 4 / streak 0：round(5*12*1.2)=72。
    // 若按 planned 封顶成 3：round(3*12*1.2)=43。
    let xp_after: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        xp_after - xp_before,
        72,
        "b. total_xp delta uses actual_units=5, not planned_units=3"
    );
    assert_eq!(result.xp_awarded, 72);

    let session_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions WHERE task_id = ?1")
            .bind(task_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(session_count, 1, "c. no remainder session");
    let negative_planned: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM task_sessions WHERE task_id = ?1 AND planned_units < 0",
    )
    .bind(task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(negative_planned, 0, "c. no planned_units=-2 row");

    let logs: Vec<(i64, Option<i64>)> =
        sqlx::query_as("SELECT duration_min, session_id FROM actual_logs WHERE session_id = ?1")
            .bind(session_id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(logs.len(), 1, "d. one actual_logs row");
    assert_eq!(
        logs[0].0, 60,
        "d. duration_min is 09:00–10:00, independent of unit count"
    );
    assert_eq!(logs[0].1, Some(session_id));
}

/// `task_progress.round_units` 是当前轮 SUM，可以大于 `total_units`。
/// 环心文字由前端测 `task_detail_progress_ring_shows_units_above_total` 钉成 `25/20`。
#[tokio::test]
async fn progress_ring_allows_current_round_units_above_total() {
    let (path, pool, conn) = open_file_db().await;
    let task_id = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round)
           VALUES ('超额进度', 'main', '数学', '课', 20, 1, 1)"#,
    )
    .execute(&pool)
    .await
    .expect("insert task")
    .last_insert_rowid();

    let now = Local::now();
    for (actual, start, end) in [(15_i64, "09:00", "10:00"), (10, "11:00", "12:00")] {
        let session_id = sqlx::query(
            r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, planned_units, status)
               VALUES (?1, '2026-11-04', ?2, ?3, 1, ?4, 'planned')"#,
        )
        .bind(task_id)
        .bind(start)
        .bind(end)
        .bind(actual)
        .execute(&pool)
        .await
        .expect("insert session")
        .last_insert_rowid();
        complete_session_impl(&pool, session_id, actual, Some(3), None, false, now, None)
            .await
            .expect("complete");
    }

    let progress = task_progress_impl(&conn, task_id).expect("task_progress");
    assert_eq!(
        progress.round_units, 25,
        "a. current-round sum stays 25, not clamped to total_units=20"
    );
    assert_eq!(progress.total_units_done, 25);

    drop(conn);
    pool.close().await;
    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn list_sessions_in_range_includes_bounds_and_sorts() {
    let pool = common::setup().await;
    let (task_id, midday_id) = insert_task_and_session(&pool).await;

    async fn add(pool: &SqlitePool, task_id: i64, date: &str, start: &str) {
        sqlx::query(
            r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, planned_units, status)
               VALUES (?1, ?2, ?3, '21:00', 1, 1, 'planned')"#,
        )
        .bind(task_id)
        .bind(date)
        .bind(start)
        .execute(pool)
        .await
        .expect("insert ranged session");
    }

    add(&pool, task_id, "2026-11-04", "08:00").await;
    add(&pool, task_id, "2026-11-01", "19:00").await;
    add(&pool, task_id, "2026-11-30", "07:00").await;
    add(&pool, task_id, "2026-10-31", "09:00").await;
    add(&pool, task_id, "2026-12-01", "09:00").await;

    let rows = list_sessions_in_range_impl(&pool, "2026-11-1", "2026-11-30")
        .await
        .expect("range");
    let keys: Vec<_> = rows
        .iter()
        .map(|s| (s.date.as_str(), s.start_time.as_str()))
        .collect();
    assert_eq!(
        keys,
        vec![
            ("2026-11-01", "19:00"),
            ("2026-11-04", "08:00"),
            ("2026-11-04", "09:00"),
            ("2026-11-30", "07:00"),
        ]
    );
    assert!(rows.iter().any(|s| s.id == midday_id));
    assert!(rows.iter().all(|s| s.task_title.as_deref() == Some("测试任务")));
    assert!(rows.iter().all(|s| s.task_color.as_deref() == Some("#F97316")));

    let empty = list_sessions_in_range_impl(&pool, "2026-12-01", "2026-11-01")
        .await
        .expect("inverted range");
    assert!(empty.is_empty());
}

async fn open_file_db() -> (PathBuf, SqlitePool, Connection) {
    let path =
        std::env::temp_dir().join(format!("timequest-over-units-{}.db", uuid::Uuid::new_v4()));
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    let path_str = path.to_string_lossy().replace('\\', "/");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&format!("sqlite:{path_str}?mode=rwc"))
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

fn noon() -> chrono::DateTime<Local> {
    Local
        .with_ymd_and_hms(2026, 11, 4, 12, 0, 0)
        .single()
        .expect("noon")
}

async fn prime_streak(pool: &SqlitePool, current: i64, last_done: &str) {
    sqlx::query(
        "UPDATE user_stats SET current_streak = ?1, longest_streak = ?1, last_done_date = ?2 WHERE id = 1",
    )
    .bind(current)
    .bind(last_done)
    .execute(pool)
    .await
    .unwrap();
}

async fn shift_session(pool: &SqlitePool, session_id: i64, start: &str, end: &str) {
    sqlx::query("UPDATE task_sessions SET start_time = ?1, end_time = ?2 WHERE id = ?3")
        .bind(start)
        .bind(end)
        .bind(session_id)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn complete_flags_task_fully_completed_only_when_current_round_crosses_total() {
    let pool = common::setup().await;
    let (task_id, session_a) = insert_task_session(&pool, 6, 1).await;
    sqlx::query("UPDATE tasks SET total_units = 10, title = '数学必修一' WHERE id = ?1")
        .bind(task_id)
        .execute(&pool)
        .await
        .unwrap();
    let now = noon();

    let first = complete_session_impl(&pool, session_a, 6, Some(4), None, false, now, None)
        .await
        .unwrap();
    assert!(!first.is_task_fully_completed, "6/10 has not cleared the book");
    assert_eq!(first.current_streak, 1);
    assert_eq!(first.streak_milestone, None);

    let session_zero = insert_session_on_date(&pool, task_id, "2026-11-04", 1).await;
    shift_session(&pool, session_zero, "11:00", "12:00").await;
    let zero = complete_session_impl(&pool, session_zero, 0, Some(3), None, false, now, None)
        .await
        .unwrap();
    assert!(!zero.is_task_fully_completed);
    assert_eq!(zero.current_streak, 1, "zero units must not move the streak");
    assert_eq!(zero.streak_milestone, None);

    let session_b = insert_session_on_date(&pool, task_id, "2026-11-04", 4).await;
    shift_session(&pool, session_b, "13:00", "14:00").await;
    let crossed = complete_session_impl(&pool, session_b, 4, Some(5), None, false, now, None)
        .await
        .unwrap();
    assert!(crossed.is_task_fully_completed);
    assert_eq!(crossed.session.task_title.as_deref(), Some("数学必修一"));
    assert_eq!(crossed.streak_milestone, None, "same day must not raise the streak");

    let session_c = insert_session_on_date(&pool, task_id, "2026-11-04", 2).await;
    shift_session(&pool, session_c, "15:00", "16:00").await;
    let extra = complete_session_impl(&pool, session_c, 2, Some(4), None, false, now, None)
        .await
        .unwrap();
    assert!(
        !extra.is_task_fully_completed,
        "already past total must not celebrate again"
    );
}

#[tokio::test]
async fn complete_does_not_flag_side_task_or_other_round() {
    let pool = common::setup().await;
    let (side_id, side_session) = insert_task_session(&pool, 5, 1).await;
    sqlx::query("UPDATE tasks SET type = 'side', total_units = 5 WHERE id = ?1")
        .bind(side_id)
        .execute(&pool)
        .await
        .unwrap();
    let side = complete_session_impl(&pool, side_session, 5, Some(4), None, false, noon(), None)
        .await
        .unwrap();
    assert!(!side.is_task_fully_completed);

    let pool = common::setup().await;
    let (task_id, old_session) = insert_task_session(&pool, 5, 1).await;
    sqlx::query("UPDATE tasks SET current_round = 2, total_units = 5 WHERE id = ?1")
        .bind(task_id)
        .execute(&pool)
        .await
        .unwrap();
    let old = complete_session_impl(&pool, old_session, 5, Some(4), None, false, noon(), None)
        .await
        .unwrap();
    assert!(
        !old.is_task_fully_completed,
        "units on round 1 do not fill current round 2"
    );
}

#[tokio::test]
async fn complete_flags_streak_milestone_only_when_streak_newly_hits_7_14_or_30() {
    let now = noon();

    let pool = common::setup().await;
    prime_streak(&pool, 6, "2026-11-03").await;
    let (task_id, session) = insert_task_and_session(&pool).await;
    let hit = complete_session_impl(&pool, session, 1, Some(4), None, false, now, None)
        .await
        .unwrap();
    assert_eq!(hit.current_streak, 7);
    assert_eq!(hit.streak_milestone, Some(7));
    assert!(!hit.is_task_fully_completed, "seed total_units is 40");

    let again_id = insert_session_on_date(&pool, task_id, "2026-11-04", 1).await;
    shift_session(&pool, again_id, "11:00", "12:00").await;
    let again = complete_session_impl(&pool, again_id, 1, Some(4), None, false, now, None)
        .await
        .unwrap();
    assert_eq!(again.current_streak, 7);
    assert_eq!(again.streak_milestone, None);

    let pool = common::setup().await;
    prime_streak(&pool, 6, "2026-11-03").await;
    let (_task_id, zero_session) = insert_task_and_session(&pool).await;
    let zero = complete_session_impl(&pool, zero_session, 0, Some(3), None, false, now, None)
        .await
        .unwrap();
    assert_eq!(zero.current_streak, 6);
    assert_eq!(zero.streak_milestone, None);

    for (before, milestone) in [(13_i64, 14_i64), (29_i64, 30_i64)] {
        let pool = common::setup().await;
        prime_streak(&pool, before, "2026-11-03").await;
        let (_task_id, id) = insert_task_and_session(&pool).await;
        let result = complete_session_impl(&pool, id, 1, Some(4), None, false, now, None)
            .await
            .unwrap();
        assert_eq!(result.current_streak, milestone);
        assert_eq!(result.streak_milestone, Some(milestone));
    }

    let pool = common::setup().await;
    prime_streak(&pool, 7, "2026-11-03").await;
    let (_task_id, id) = insert_task_and_session(&pool).await;
    let eight = complete_session_impl(&pool, id, 1, Some(4), None, false, now, None)
        .await
        .unwrap();
    assert_eq!(eight.current_streak, 8);
    assert_eq!(eight.streak_milestone, None);
}

#[tokio::test]
async fn idempotent_complete_does_not_repeat_celebration_flags() {
    let pool = common::setup().await;
    let (task_id, session_id) = insert_task_session(&pool, 4, 1).await;
    sqlx::query("UPDATE tasks SET total_units = 4 WHERE id = ?1")
        .bind(task_id)
        .execute(&pool)
        .await
        .unwrap();
    let now = noon();
    let first = complete_session_impl(&pool, session_id, 4, Some(5), None, false, now, None)
        .await
        .unwrap();
    assert!(first.is_task_fully_completed);
    assert_eq!(first.current_streak, 1);

    let second = complete_session_impl(&pool, session_id, 4, Some(5), None, false, now, None)
        .await
        .unwrap();
    assert_eq!(second.xp_awarded, 0);
    assert!(!second.is_task_fully_completed);
    assert_eq!(second.streak_milestone, None);
    assert_eq!(second.current_streak, 1);
}
