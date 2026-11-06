mod common;

use chrono::{Duration, Local, NaiveDate};
use sqlx::SqlitePool;
use timequest_lib::{
    advance_round_impl, complete_session_impl, reschedule_session_impl, RESCHEDULE_RECOVERY_BONUS,
};

async fn insert_task(
    pool: &SqlitePool,
    task_type: &str,
    total_units: i64,
    current_round: i64,
) -> i64 {
    let row = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round, color)
           VALUES ('成就任务', ?1, '数学', '课', ?2, 2, ?3, '#F97316')"#,
    )
    .bind(task_type)
    .bind(total_units)
    .bind(current_round)
    .execute(pool)
    .await
    .expect("insert task");
    row.last_insert_rowid()
}

async fn insert_planned_session(
    pool: &SqlitePool,
    task_id: i64,
    date: &str,
    round: i64,
    planned_units: i64,
    start: &str,
    end: &str,
) -> i64 {
    let row = sqlx::query(
        r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, planned_units, status)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'planned')"#,
    )
    .bind(task_id)
    .bind(date)
    .bind(start)
    .bind(end)
    .bind(round)
    .bind(planned_units)
    .execute(pool)
    .await
    .expect("insert session");
    row.last_insert_rowid()
}

async fn achievement_count(pool: &SqlitePool, id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM user_achievements WHERE achievement_id = ?1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn sum_done_actual_units(pool: &SqlitePool, task_id: i64, round: i64) -> i64 {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(actual_units),0) FROM task_sessions WHERE task_id = ?1 AND round = ?2 AND status = 'done'",
    )
    .bind(task_id)
    .bind(round)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn today() -> NaiveDate {
    Local::now().date_naive()
}

fn date_str(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// first_round: main 任务当前轮 sum(actual_units) >= total_units。
#[tokio::test]
async fn unlocks_first_round_once_when_round_progress_meets_total() {
    let pool = common::setup().await;
    // total_units=3：一次完成即可达标，避免多余 session
    let task_id = insert_task(&pool, "main", 3, 1).await;
    let date = date_str(today());
    let s1 = insert_planned_session(&pool, task_id, &date, 1, 3, "09:00", "10:00").await;

    let now = Local::now();
    let first = complete_session_impl(&pool, s1, 3, Some(3), None, false, now, None)
        .await
        .expect("complete to unlock first_round");

    assert!(
        first.new_achievements.iter().any(|a| a == "first_round"),
        "expected first_round in {:?}",
        first.new_achievements
    );
    assert_eq!(achievement_count(&pool, "first_round").await, 1);

    // 同轮再完成一节：sum 仍 ≥ total，但不得重复插入
    let s2 = insert_planned_session(&pool, task_id, &date, 1, 1, "11:00", "12:00").await;
    let second = complete_session_impl(&pool, s2, 1, Some(3), None, false, now, None)
        .await
        .expect("second complete same round");
    assert!(
        !second.new_achievements.iter().any(|a| a == "first_round"),
        "first_round must unlock only once, got {:?}",
        second.new_achievements
    );
    assert_eq!(achievement_count(&pool, "first_round").await, 1);
}

/// comeback: 存在 rescheduled_to → 本 session，且 actual_units > 0、自评 ≥ 4。
#[tokio::test]
async fn unlocks_comeback_once_after_reschedule_with_high_rating() {
    let pool = common::setup().await;
    // side + 大 total_units，避免顺带解锁 first_round
    let task_id = insert_task(&pool, "side", 100, 1).await;
    let date = date_str(today());
    let s_a = insert_planned_session(&pool, task_id, &date, 1, 2, "09:00", "10:00").await;

    let now = Local::now();
    let reschedule = reschedule_session_impl(
        &pool,
        s_a,
        date.clone(),
        "16:00".into(),
        "17:00".into(),
        now,
    )
    .await
    .expect("reschedule");
    let s_b = reschedule
        .created_session_id
        .expect("reschedule creates target");

    let first = complete_session_impl(&pool, s_b, 2, Some(4), None, false, now, None)
        .await
        .expect("complete after reschedule with rating 4");

    assert!(
        first.new_achievements.iter().any(|a| a == "comeback"),
        "expected comeback in {:?}",
        first.new_achievements
    );
    assert_eq!(achievement_count(&pool, "comeback").await, 1);

    // 再次改期+高自评完成：幂等
    let s_c = insert_planned_session(&pool, task_id, &date, 1, 2, "18:00", "19:00").await;
    let again = reschedule_session_impl(
        &pool,
        s_c,
        date.clone(),
        "20:00".into(),
        "21:00".into(),
        now,
    )
    .await
    .expect("second reschedule");
    let s_d = again.created_session_id.expect("target");
    let second = complete_session_impl(&pool, s_d, 2, Some(5), None, false, now, None)
        .await
        .expect("second comeback-eligible complete");
    assert!(
        !second.new_achievements.iter().any(|a| a == "comeback"),
        "comeback must unlock only once, got {:?}",
        second.new_achievements
    );
    assert_eq!(achievement_count(&pool, "comeback").await, 1);
}

/// 0 单位完成仍被允许（见 completion_with_zero_units_awards_no_xp），
/// 但改期后 0 单位 + 高自评不得解锁 comeback（需 actual_units > 0）。
#[tokio::test]
async fn zero_units_after_reschedule_does_not_unlock_comeback() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool, "side", 100, 1).await;
    let date = date_str(today());
    let s_a = insert_planned_session(&pool, task_id, &date, 1, 2, "09:00", "10:00").await;

    let now = Local::now();
    let reschedule = reschedule_session_impl(
        &pool,
        s_a,
        date.clone(),
        "16:00".into(),
        "17:00".into(),
        now,
    )
    .await
    .expect("reschedule");
    let s_b = reschedule
        .created_session_id
        .expect("reschedule creates target");

    let result = complete_session_impl(&pool, s_b, 0, Some(4), None, false, now, None)
        .await
        .expect("zero-unit complete is allowed");

    assert_eq!(result.session.status, "done");
    assert_eq!(result.session.actual_units, 0);
    assert!(
        !result.new_achievements.iter().any(|a| a == "comeback"),
        "0 units + rating 4 must not unlock comeback, got {:?}",
        result.new_achievements
    );
    assert_eq!(achievement_count(&pool, "comeback").await, 0);
}

/// balanced: 近 7 个本地日内主线与副本均有 done。
#[tokio::test]
async fn unlocks_balanced_once_when_main_and_side_done_in_week() {
    let pool = common::setup().await;
    let date = date_str(today());
    let main_id = insert_task(&pool, "main", 100, 1).await;
    let side_id = insert_task(&pool, "side", 100, 1).await;
    let s_main = insert_planned_session(&pool, main_id, &date, 1, 1, "09:00", "10:00").await;
    let s_side = insert_planned_session(&pool, side_id, &date, 1, 1, "11:00", "12:00").await;

    let now = Local::now();
    complete_session_impl(&pool, s_main, 1, Some(3), None, false, now, None)
        .await
        .expect("complete main");
    assert_eq!(
        achievement_count(&pool, "balanced").await,
        0,
        "main alone must not unlock balanced"
    );

    let first = complete_session_impl(&pool, s_side, 1, Some(3), None, false, now, None)
        .await
        .expect("complete side → balanced");
    assert!(
        first.new_achievements.iter().any(|a| a == "balanced"),
        "expected balanced in {:?}",
        first.new_achievements
    );
    assert_eq!(achievement_count(&pool, "balanced").await, 1);

    let s_side2 = insert_planned_session(&pool, side_id, &date, 1, 1, "14:00", "15:00").await;
    let second = complete_session_impl(&pool, s_side2, 1, Some(3), None, false, now, None)
        .await
        .expect("another complete in-window");
    assert!(
        !second.new_achievements.iter().any(|a| a == "balanced"),
        "balanced must unlock only once, got {:?}",
        second.new_achievements
    );
    assert_eq!(achievement_count(&pool, "balanced").await, 1);
}

/// streak_5: current_streak >= 5（连续本地日完成）。
#[tokio::test]
async fn unlocks_streak_5_once_after_five_consecutive_days() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool, "side", 100, 1).await;
    let today = today();
    let now = Local::now();

    let mut last_achievements = Vec::new();
    for i in 0..5 {
        // i=0 → today-4 … i=4 → today：连续 5 个本地日
        let d = today - Duration::days(4 - i);
        let date = date_str(d);
        let sid = insert_planned_session(&pool, task_id, &date, 1, 1, "09:00", "10:00").await;
        let res = complete_session_impl(&pool, sid, 1, Some(3), None, false, now, None)
            .await
            .expect("complete consecutive day");
        last_achievements = res.new_achievements;
        if i < 4 {
            assert!(
                !last_achievements.iter().any(|a| a == "streak_5"),
                "streak_5 must not unlock before day 5 (i={i})"
            );
            assert_eq!(achievement_count(&pool, "streak_5").await, 0);
        }
    }

    assert!(
        last_achievements.iter().any(|a| a == "streak_5"),
        "expected streak_5 on 5th consecutive day, got {:?}",
        last_achievements
    );
    assert_eq!(achievement_count(&pool, "streak_5").await, 1);

    let streak: i64 = sqlx::query_scalar("SELECT current_streak FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(streak, 5);

    // 同日再完成：streak 仍 ≥ 5，不得重复插入
    let same_day = date_str(today);
    let extra = insert_planned_session(&pool, task_id, &same_day, 1, 1, "11:00", "12:00").await;
    let second = complete_session_impl(&pool, extra, 1, Some(3), None, false, now, None)
        .await
        .expect("same-day extra complete");
    assert!(
        !second.new_achievements.iter().any(|a| a == "streak_5"),
        "streak_5 must unlock only once, got {:?}",
        second.new_achievements
    );
    assert_eq!(achievement_count(&pool, "streak_5").await, 1);
}

/// first_round 只在本轮 sum(actual_units) 达到 total_units 时解锁，且只插一行。
/// 6 < 10 不解锁；9（差 1）不解锁；10 解锁；12 不重复插入。
#[tokio::test]
async fn first_round_unlocks_only_when_sum_reaches_total() {
    let pool = common::setup().await;
    let task = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round, color)
           VALUES ('首轮阈值', 'main', '数学', '课', 10, 1, 1, '#F97316')"#,
    )
    .execute(&pool)
    .await
    .expect("insert main task total_units=10");
    let task_id = task.last_insert_rowid();
    let date = date_str(today());
    let now = Local::now();

    let s1 = insert_planned_session(&pool, task_id, &date, 1, 6, "09:00", "10:00").await;
    let s2 = insert_planned_session(&pool, task_id, &date, 1, 4, "10:00", "11:00").await;

    let first = complete_session_impl(&pool, s1, 6, Some(3), None, false, now, None)
        .await
        .expect("complete S1 actual_units=6");
    assert!(
        !first.new_achievements.iter().any(|a| a == "first_round"),
        "sum=6 < 10 must not unlock first_round, got {:?}",
        first.new_achievements
    );
    assert_eq!(achievement_count(&pool, "first_round").await, 0);
    assert_eq!(sum_done_actual_units(&pool, task_id, 1).await, 6);

    let second = complete_session_impl(&pool, s2, 3, Some(3), None, false, now, None)
        .await
        .expect("complete S2 actual_units=3");
    assert!(
        !second.new_achievements.iter().any(|a| a == "first_round"),
        "sum=9 is one short of 10 and must not unlock first_round, got {:?}",
        second.new_achievements
    );
    assert_eq!(
        achievement_count(&pool, "first_round").await,
        0,
        "差 1（sum=9 < total_units=10）不得解锁 first_round"
    );
    assert_eq!(sum_done_actual_units(&pool, task_id, 1).await, 9);

    let s3 = insert_planned_session(&pool, task_id, &date, 1, 1, "11:00", "12:00").await;
    let third = complete_session_impl(&pool, s3, 1, Some(3), None, false, now, None)
        .await
        .expect("complete S3 actual_units=1");
    assert!(
        third.new_achievements.iter().any(|a| a == "first_round"),
        "sum=10 must unlock first_round, got {:?}",
        third.new_achievements
    );
    assert_eq!(achievement_count(&pool, "first_round").await, 1);
    assert_eq!(sum_done_actual_units(&pool, task_id, 1).await, 10);

    let s4 = insert_planned_session(&pool, task_id, &date, 1, 2, "13:00", "14:00").await;
    let fourth = complete_session_impl(&pool, s4, 2, Some(3), None, false, now, None)
        .await
        .expect("complete S4 actual_units=2");
    assert!(
        !fourth.new_achievements.iter().any(|a| a == "first_round"),
        "sum=12 must not insert first_round again, got {:?}",
        fourth.new_achievements
    );
    assert_eq!(achievement_count(&pool, "first_round").await, 1);
    assert_eq!(sum_done_actual_units(&pool, task_id, 1).await, 12);
}

async fn done_session_row(pool: &SqlitePool, session_id: i64) -> (String, i64, i64, i64, i64) {
    sqlx::query_as(
        r#"SELECT status, round, planned_units, actual_units, xp_awarded
           FROM task_sessions WHERE id = ?1"#,
    )
    .bind(session_id)
    .fetch_one(pool)
    .await
    .expect("load session row")
}

/// 只统计当前轮。历史轮已完成的 actual_units 不得并进本轮合计。
#[tokio::test]
async fn first_round_ignores_other_rounds() {
    let pool = common::setup().await;
    // total_rounds 由 insert_task 写成 2；current_round=2
    let task_id = insert_task(&pool, "main", 10, 2).await;
    let date = date_str(today());
    let now = Local::now();

    let s1 = sqlx::query(
        r#"INSERT INTO task_sessions
             (task_id, date, start_time, end_time, round, planned_units, actual_units, status, xp_awarded)
           VALUES (?1, ?2, '08:00', '09:00', 1, 6, 6, 'done', 72)"#,
    )
    .bind(task_id)
    .bind(&date)
    .execute(&pool)
    .await
    .expect("insert historical round-1 session")
    .last_insert_rowid();
    let s1_before = done_session_row(&pool, s1).await;
    assert_eq!(s1_before, ("done".into(), 1, 6, 6, 72));

    let s2 = insert_planned_session(&pool, task_id, &date, 2, 4, "10:00", "11:00").await;
    let current = complete_session_impl(&pool, s2, 4, Some(3), None, false, now, None)
        .await
        .expect("complete S2 actual_units=4");
    assert!(
        !current.new_achievements.iter().any(|a| a == "first_round"),
        "round=2 sum=4 must not unlock even if round=1 already has 6, got {:?}",
        current.new_achievements
    );
    assert_eq!(
        achievement_count(&pool, "first_round").await,
        0,
        "当前轮 sum=4 < 10，不得把 round=1 的 6 并进合计后解锁"
    );
    assert_eq!(sum_done_actual_units(&pool, task_id, 2).await, 4);
    assert_eq!(sum_done_actual_units(&pool, task_id, 1).await, 6);
    assert_eq!(
        done_session_row(&pool, s1).await,
        s1_before,
        "完成当前轮不得改写 round=1 的历史场次"
    );

    let s3 = insert_planned_session(&pool, task_id, &date, 2, 6, "12:00", "13:00").await;
    let reach = complete_session_impl(&pool, s3, 6, Some(3), None, false, now, None)
        .await
        .expect("complete S3 actual_units=6");
    assert!(
        reach.new_achievements.iter().any(|a| a == "first_round"),
        "round=2 sum=10 must unlock first_round, got {:?}",
        reach.new_achievements
    );
    assert_eq!(achievement_count(&pool, "first_round").await, 1);
    assert_eq!(sum_done_actual_units(&pool, task_id, 2).await, 10);
    assert_eq!(sum_done_actual_units(&pool, task_id, 1).await, 6);
    assert_eq!(
        done_session_row(&pool, s1).await,
        s1_before,
        "达标解锁后 round=1 的 status/round/planned/actual/xp 仍应保持原值"
    );
}

/// side 任务即使本轮 actual_units 达到 total_units，也不解锁 first_round，XP 照发。
#[tokio::test]
async fn first_round_not_unlocked_for_side_task() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool, "side", 5, 1).await;
    let date = date_str(today());
    let sid = insert_planned_session(&pool, task_id, &date, 1, 5, "09:00", "10:00").await;

    let xp_before: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();

    let now = Local::now();
    let done = complete_session_impl(&pool, sid, 5, Some(3), None, false, now, None)
        .await
        .expect("complete side session");

    assert!(
        !done.new_achievements.iter().any(|a| a == "first_round"),
        "side task must not unlock first_round, got {:?}",
        done.new_achievements
    );
    assert_eq!(achievement_count(&pool, "first_round").await, 0);

    let xp_after: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        xp_after - xp_before > 0,
        "side completion must still award XP, before={xp_before} after={xp_after}"
    );
}

/// total_units 为 NULL 或 0 时 first_round 永不解锁，由应用层守卫保证，
/// 不依赖数据库层 NULL 比较语义。
///
/// 成就检查只在 complete_session_impl 里，因此场景 A 走 actual_units=0 的完成路径。
#[tokio::test]
async fn first_round_does_not_unlock_on_null_or_zero_total() {
    let pool = common::setup().await;
    let date = date_str(today());
    let now = Local::now();

    // 场景 A：total_units = 0。0 >= 0 不得当成达标。
    let zero_task = insert_task(&pool, "main", 0, 1).await;
    let zero_session =
        insert_planned_session(&pool, zero_task, &date, 1, 0, "09:00", "10:00").await;
    let zero_done = complete_session_impl(&pool, zero_session, 0, Some(3), None, false, now, None)
        .await
        .expect("complete session when total_units is 0");
    assert!(
        !zero_done
            .new_achievements
            .iter()
            .any(|a| a == "first_round"),
        "total_units=0 must not unlock first_round, got {:?}",
        zero_done.new_achievements
    );
    assert_eq!(achievement_count(&pool, "first_round").await, 0);

    // 场景 B：total_units = NULL。完成必须成功，且不得解锁。
    let null_task = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round, color)
           VALUES ('空目标', 'main', '数学', '课', NULL, 1, 1, '#F97316')"#,
    )
    .execute(&pool)
    .await
    .expect("insert task with NULL total_units")
    .last_insert_rowid();
    let null_session =
        insert_planned_session(&pool, null_task, &date, 1, 3, "11:00", "12:00").await;
    let null_done = complete_session_impl(&pool, null_session, 3, Some(3), None, false, now, None)
        .await
        .expect("NULL total_units must not fail the complete path");
    assert!(
        !null_done
            .new_achievements
            .iter()
            .any(|a| a == "first_round"),
        "NULL total_units must not unlock first_round, got {:?}",
        null_done.new_achievements
    );
    assert_eq!(achievement_count(&pool, "first_round").await, 0);
}

async fn total_xp(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(pool)
        .await
        .unwrap()
}

/// 改期出一场 side session，返回新场 id。side + 大 total_units，避免捎带 first_round。
async fn reschedule_side_session(pool: &SqlitePool, planned_units: i64) -> i64 {
    let task_id = insert_task(pool, "side", 100, 1).await;
    let date = date_str(today());
    let original =
        insert_planned_session(pool, task_id, &date, 1, planned_units, "09:00", "10:00").await;
    let now = Local::now();
    let moved = reschedule_session_impl(pool, original, date, "16:00".into(), "17:00".into(), now)
        .await
        .expect("reschedule");
    moved.created_session_id.expect("reschedule creates target")
}

/// 改期恢复后：3 单位 + 4 星才同时给 comeback 和恢复 XP。
/// 3 星不加恢复 XP；0 单位不加 XP、不解锁；非改期来源不解锁。
#[tokio::test]
async fn comeback_unlocks_only_when_units_positive_and_rating_high() {
    let now = Local::now();

    // 1. 3 单位 + 4 星，来自改期。side 基础 XP = 3 * 10 * 1.2 = 36，再加恢复奖励。
    {
        let pool = common::setup().await;
        let target = reschedule_side_session(&pool, 3).await;
        let before = total_xp(&pool).await;
        let done = complete_session_impl(&pool, target, 3, Some(4), None, false, now, None)
            .await
            .expect("complete 3 units rating 4 after reschedule");
        let delta = total_xp(&pool).await - before;
        assert!(
            done.new_achievements.iter().any(|a| a == "comeback"),
            "3 units + rating 4 from reschedule must unlock comeback, got {:?}",
            done.new_achievements
        );
        assert_eq!(achievement_count(&pool, "comeback").await, 1);
        assert_eq!(delta, 36 + RESCHEDULE_RECOVERY_BONUS);
        assert_eq!(done.xp_awarded, delta);
    }

    // 2. 3 单位 + 3 星：不解锁，且 total_xp 不含恢复奖励。side 基础 XP = 3 * 10 * 1.0 = 30。
    {
        let pool = common::setup().await;
        let target = reschedule_side_session(&pool, 3).await;
        let before = total_xp(&pool).await;
        let done = complete_session_impl(&pool, target, 3, Some(3), None, false, now, None)
            .await
            .expect("complete 3 units rating 3 after reschedule");
        let delta = total_xp(&pool).await - before;
        assert!(
            !done.new_achievements.iter().any(|a| a == "comeback"),
            "rating 3 must not unlock comeback, got {:?}",
            done.new_achievements
        );
        assert_eq!(achievement_count(&pool, "comeback").await, 0);
        assert_eq!(
            delta, 30,
            "rating 3 must not include recovery bonus, delta={delta}"
        );
        assert_eq!(done.xp_awarded, delta);
    }

    // 3. 0 单位 + 4 星：完成路径允许 0 单位。不解锁，total_xp 不变。
    {
        let pool = common::setup().await;
        let target = reschedule_side_session(&pool, 3).await;
        let before = total_xp(&pool).await;
        let done = complete_session_impl(&pool, target, 0, Some(4), None, false, now, None)
            .await
            .expect("0-unit complete is allowed");
        assert!(
            !done.new_achievements.iter().any(|a| a == "comeback"),
            "0 units + rating 4 must not unlock comeback, got {:?}",
            done.new_achievements
        );
        assert_eq!(achievement_count(&pool, "comeback").await, 0);
        assert_eq!(total_xp(&pool).await, before);
        assert_eq!(done.xp_awarded, 0);
    }

    // 4. 3 单位 + 5 星，但不是改期恢复来的场次。
    {
        let pool = common::setup().await;
        let task_id = insert_task(&pool, "side", 100, 1).await;
        let date = date_str(today());
        let sid = insert_planned_session(&pool, task_id, &date, 1, 3, "09:00", "10:00").await;
        let done = complete_session_impl(&pool, sid, 3, Some(5), None, false, now, None)
            .await
            .expect("complete without reschedule");
        assert!(
            !done.new_achievements.iter().any(|a| a == "comeback"),
            "comeback requires a rescheduled_to pointer, got {:?}",
            done.new_achievements
        );
        assert_eq!(achievement_count(&pool, "comeback").await, 0);
    }
}

/// 改期恢复 + 3 单位 + 4 星：恢复 XP 与 comeback 在同一次完成里一起发生。
#[tokio::test]
async fn comeback_recovery_xp_and_achievement_stay_in_sync() {
    let pool = common::setup().await;
    let now = Local::now();
    let target = reschedule_side_session(&pool, 3).await;
    let before = total_xp(&pool).await;
    let done = complete_session_impl(&pool, target, 3, Some(4), None, false, now, None)
        .await
        .expect("complete rescheduled session");
    let delta = total_xp(&pool).await - before;

    let unlocked = done.new_achievements.iter().any(|a| a == "comeback");
    let xp_includes_bonus = delta >= RESCHEDULE_RECOVERY_BONUS && done.xp_awarded == delta;
    assert!(
        unlocked && xp_includes_bonus,
        "comeback and recovery XP must both happen on this completion: achievements={:?} xp_awarded={} delta={delta}",
        done.new_achievements,
        done.xp_awarded
    );
    assert_eq!(achievement_count(&pool, "comeback").await, 1);
    assert_eq!(delta, 36 + RESCHEDULE_RECOVERY_BONUS);
}

fn days_ago(n: i64) -> String {
    date_str(today() - Duration::days(n))
}

async fn insert_done_session(
    pool: &SqlitePool,
    task_id: i64,
    date: &str,
    round: i64,
    planned_units: i64,
    actual_units: i64,
    start: &str,
    end: &str,
) -> i64 {
    sqlx::query(
        r#"INSERT INTO task_sessions
             (task_id, date, start_time, end_time, round, planned_units, actual_units, status)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'done')"#,
    )
    .bind(task_id)
    .bind(date)
    .bind(start)
    .bind(end)
    .bind(round)
    .bind(planned_units)
    .bind(actual_units)
    .execute(pool)
    .await
    .expect("insert done session")
    .last_insert_rowid()
}

/// 10 天前的主线+副本不计入；3 天前主线 + 2 天前副本计入。锚是本场 session.date。
#[tokio::test]
async fn balanced_window_uses_session_date_not_wall_clock() {
    let now = Local::now();

    let pool = common::setup().await;
    let main_id = insert_task(&pool, "main", 100, 1).await;
    let side_id = insert_task(&pool, "side", 100, 1).await;
    let old = days_ago(10);
    // 直接写成 done，避免在 date=today-10 上触发检查（那个锚会把两场都算进窗口）。
    insert_done_session(&pool, main_id, &old, 1, 1, 1, "09:00", "10:00").await;
    insert_done_session(&pool, side_id, &old, 1, 1, 1, "10:00", "11:00").await;
    let today_s = days_ago(0);
    let trigger = insert_planned_session(&pool, main_id, &today_s, 1, 1, "12:00", "13:00").await;
    let outside = complete_session_impl(&pool, trigger, 1, Some(3), None, false, now, None)
        .await
        .expect("complete today session");
    assert!(
        !outside.new_achievements.iter().any(|a| a == "balanced"),
        "sessions dated today-10 must stay outside the window, got {:?}",
        outside.new_achievements
    );
    assert_eq!(achievement_count(&pool, "balanced").await, 0);

    let pool = common::setup().await;
    let main_id = insert_task(&pool, "main", 100, 1).await;
    let side_id = insert_task(&pool, "side", 100, 1).await;
    let main_s = insert_planned_session(&pool, main_id, &days_ago(3), 1, 1, "09:00", "10:00").await;
    let side_s = insert_planned_session(&pool, side_id, &days_ago(2), 1, 1, "11:00", "12:00").await;
    complete_session_impl(&pool, main_s, 1, Some(3), None, false, now, None)
        .await
        .expect("complete main today-3");
    assert_eq!(achievement_count(&pool, "balanced").await, 0);
    let inside = complete_session_impl(&pool, side_s, 1, Some(3), None, false, now, None)
        .await
        .expect("complete side today-2");
    assert!(
        inside.new_achievements.iter().any(|a| a == "balanced"),
        "today-3 main and today-2 side must unlock balanced, got {:?}",
        inside.new_achievements
    );
    assert_eq!(achievement_count(&pool, "balanced").await, 1);
}

/// 窗口内 0 单位的 done 不计入；两侧都有 actual_units > 0 才解锁。
#[tokio::test]
async fn balanced_requires_positive_units_in_window() {
    let pool = common::setup().await;
    let now = Local::now();
    let date = days_ago(0);
    let main_id = insert_task(&pool, "main", 100, 1).await;
    let side_id = insert_task(&pool, "side", 100, 1).await;
    let main_s = insert_planned_session(&pool, main_id, &date, 1, 1, "09:00", "10:00").await;
    let zero_side = insert_planned_session(&pool, side_id, &date, 1, 1, "11:00", "12:00").await;
    complete_session_impl(&pool, main_s, 1, Some(3), None, false, now, None)
        .await
        .expect("complete main with units");
    let zero = complete_session_impl(&pool, zero_side, 0, Some(4), None, false, now, None)
        .await
        .expect("0-unit side complete is allowed");
    assert!(
        !zero.new_achievements.iter().any(|a| a == "balanced"),
        "0-unit side must not count toward balanced, got {:?}",
        zero.new_achievements
    );
    assert_eq!(achievement_count(&pool, "balanced").await, 0);

    let positive_side = insert_planned_session(&pool, side_id, &date, 1, 1, "13:00", "14:00").await;
    let positive = complete_session_impl(&pool, positive_side, 1, Some(3), None, false, now, None)
        .await
        .expect("complete positive side");
    assert!(
        positive.new_achievements.iter().any(|a| a == "balanced"),
        "both types with actual_units > 0 must unlock balanced, got {:?}",
        positive.new_achievements
    );
    assert_eq!(achievement_count(&pool, "balanced").await, 1);
}

/// today-6 与 today 含在窗口内；today-7 在窗口外。解锁是一次性的，边界外用另一库。
#[tokio::test]
async fn balanced_boundary_days_inclusive() {
    let now = Local::now();

    let pool = common::setup().await;
    let main_id = insert_task(&pool, "main", 100, 1).await;
    let side_id = insert_task(&pool, "side", 100, 1).await;
    let main_s = insert_planned_session(&pool, main_id, &days_ago(6), 1, 1, "09:00", "10:00").await;
    let side_s = insert_planned_session(&pool, side_id, &days_ago(0), 1, 1, "11:00", "12:00").await;
    complete_session_impl(&pool, main_s, 1, Some(3), None, false, now, None)
        .await
        .expect("complete main on today-6");
    let on_edge = complete_session_impl(&pool, side_s, 1, Some(3), None, false, now, None)
        .await
        .expect("complete side on today");
    assert!(
        on_edge.new_achievements.iter().any(|a| a == "balanced"),
        "today-6 through today is inclusive, got {:?}",
        on_edge.new_achievements
    );
    assert_eq!(achievement_count(&pool, "balanced").await, 1);

    let pool = common::setup().await;
    let main_id = insert_task(&pool, "main", 100, 1).await;
    let side_id = insert_task(&pool, "side", 100, 1).await;
    let main_s = insert_planned_session(&pool, main_id, &days_ago(7), 1, 1, "09:00", "10:00").await;
    let side_s = insert_planned_session(&pool, side_id, &days_ago(0), 1, 1, "11:00", "12:00").await;
    complete_session_impl(&pool, main_s, 1, Some(3), None, false, now, None)
        .await
        .expect("complete main on today-7");
    let outside = complete_session_impl(&pool, side_s, 1, Some(3), None, false, now, None)
        .await
        .expect("complete side on today");
    assert!(
        !outside.new_achievements.iter().any(|a| a == "balanced"),
        "today-7 is outside [today-6, today], got {:?}",
        outside.new_achievements
    );
    assert_eq!(achievement_count(&pool, "balanced").await, 0);
}

/// 同一主线两场仍只表示“有主线”；再出现一条副本才解锁，且只有一行。
#[tokio::test]
async fn balanced_same_task_multiple_sessions_counts_once() {
    let pool = common::setup().await;
    let now = Local::now();
    let date = days_ago(0);
    let main_id = insert_task(&pool, "main", 100, 1).await;
    let side_id = insert_task(&pool, "side", 100, 1).await;
    let main_a = insert_planned_session(&pool, main_id, &date, 1, 1, "09:00", "10:00").await;
    let main_b = insert_planned_session(&pool, main_id, &date, 1, 1, "10:00", "11:00").await;
    let side_s = insert_planned_session(&pool, side_id, &date, 1, 1, "12:00", "13:00").await;

    complete_session_impl(&pool, main_a, 1, Some(3), None, false, now, None)
        .await
        .expect("first main session");
    let second_main = complete_session_impl(&pool, main_b, 1, Some(3), None, false, now, None)
        .await
        .expect("second main session same task");
    assert!(
        !second_main.new_achievements.iter().any(|a| a == "balanced"),
        "two sessions of one main task must not unlock balanced, got {:?}",
        second_main.new_achievements
    );
    assert_eq!(achievement_count(&pool, "balanced").await, 0);

    let with_side = complete_session_impl(&pool, side_s, 1, Some(3), None, false, now, None)
        .await
        .expect("one side session");
    assert!(
        with_side.new_achievements.iter().any(|a| a == "balanced"),
        "one main task plus one side task must unlock balanced, got {:?}",
        with_side.new_achievements
    );
    assert_eq!(achievement_count(&pool, "balanced").await, 1);
}

/// `first_round` 按正在完成的这场 `session.round` 求和，不读 `tasks.current_round`。
/// 成就是一次性的：`achievement_id = 'first_round'` 已有行就不再 INSERT。
/// 第 2 轮达标不会再解锁一次。
#[tokio::test]
async fn first_round_after_advance_stays_on_session_round() {
    let pool = common::setup().await;
    let now = Local::now();
    let date = date_str(today());
    let task_id = insert_task(&pool, "main", 10, 1).await;

    let s1 = insert_planned_session(&pool, task_id, &date, 1, 10, "09:00", "10:00").await;
    let first = complete_session_impl(&pool, s1, 10, Some(3), None, false, now, None)
        .await
        .expect("complete round 1");
    assert!(
        first.new_achievements.iter().any(|a| a == "first_round"),
        "round 1 sum=10 unlocks first_round, got {:?}",
        first.new_achievements
    );
    assert_eq!(achievement_count(&pool, "first_round").await, 1);

    let advanced = advance_round_impl(&pool, task_id)
        .await
        .expect("advance to round 2");
    assert_eq!(advanced.current_round, 2);

    // 推进之后才完成的旧轮场次。round 列仍是 1，不跟 current_round。
    let s2 = insert_planned_session(&pool, task_id, &date, 1, 5, "11:00", "12:00").await;
    let late = complete_session_impl(&pool, s2, 5, Some(3), None, false, now, None)
        .await
        .expect("complete leftover round 1");
    assert!(
        !late.new_achievements.iter().any(|a| a == "first_round"),
        "first_round must not insert again, got {:?}",
        late.new_achievements
    );
    assert_eq!(achievement_count(&pool, "first_round").await, 1);
    assert_eq!(
        sum_done_actual_units(&pool, task_id, 1).await,
        15,
        "S2's 5 stays on session.round = 1"
    );
    assert_eq!(
        sum_done_actual_units(&pool, task_id, 2).await,
        0,
        "S2 must not be summed into round 2"
    );

    let s3 = insert_planned_session(&pool, task_id, &date, 2, 10, "14:00", "15:00").await;
    let round2 = complete_session_impl(&pool, s3, 10, Some(3), None, false, now, None)
        .await
        .expect("complete round 2");
    assert_eq!(sum_done_actual_units(&pool, task_id, 2).await, 10);
    assert!(
        !round2.new_achievements.iter().any(|a| a == "first_round"),
        "first_round is one-shot; round 2 does not unlock it again, got {:?}",
        round2.new_achievements
    );
    assert_eq!(achievement_count(&pool, "first_round").await, 1);
}

/// `advance_round_impl` 是 `current_round + 1`，不与 `total_rounds` 比较，也不返回 Err。
#[tokio::test]
async fn advance_round_without_cap_stays_safe() {
    let pool = common::setup().await;
    // insert_task 把 total_rounds 写成 2。起点 current_round 已经等于 total_rounds。
    let task_id = insert_task(&pool, "main", 10, 2).await;

    let advanced = advance_round_impl(&pool, task_id)
        .await
        .expect("advance past total_rounds");
    assert_eq!(advanced.total_rounds, 2);
    assert_eq!(advanced.current_round, 3);
}

/// `first_round` 判定是 `sum >= total_units`。刚好 10 与超额 12 都会解锁。
/// 成就主键全局只有一行，所以超额放在另一份库上；同一目录里第二个任务不会再 INSERT。
#[tokio::test]
async fn first_round_unlocks_on_exact_and_above_total() {
    let now = Local::now();
    let date = date_str(today());

    let pool_exact = common::setup().await;
    let task_exact = insert_task(&pool_exact, "main", 10, 1).await;
    let s1 = insert_planned_session(&pool_exact, task_exact, &date, 1, 10, "09:00", "10:00").await;
    let exact = complete_session_impl(&pool_exact, s1, 10, Some(3), None, false, now, None)
        .await
        .expect("exact total");
    assert!(
        exact.new_achievements.iter().any(|a| a == "first_round"),
        "actual_units=10 >= total_units=10 unlocks, got {:?}",
        exact.new_achievements
    );
    assert_eq!(achievement_count(&pool_exact, "first_round").await, 1);

    let pool_over = common::setup().await;
    let task_over = insert_task(&pool_over, "main", 10, 1).await;
    let s2 = insert_planned_session(&pool_over, task_over, &date, 1, 10, "09:00", "10:00").await;
    let over = complete_session_impl(&pool_over, s2, 12, Some(3), None, false, now, None)
        .await
        .expect("above total");
    assert!(
        over.new_achievements.iter().any(|a| a == "first_round"),
        "actual_units=12 >= total_units=10 must unlock (>=, not ==), got {:?}",
        over.new_achievements
    );
    assert_eq!(achievement_count(&pool_over, "first_round").await, 1);
    assert_eq!(sum_done_actual_units(&pool_over, task_over, 1).await, 12);
}
