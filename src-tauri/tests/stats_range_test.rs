mod common;

use chrono::{Datelike, Duration, Local, NaiveDate};
use sqlx::SqlitePool;
use timequest_lib::{
    stats_completion_rate_impl, stats_method_share_impl, stats_plan_vs_actual_impl,
    stats_tag_type_totals_impl,
};

/// 统计页「本周」由前端 `rangeFor` 算好再传入（`src/pages/Stats.tsx`）。
/// Rust 只收 `from` / `to`，不识别 `"week"`。
///
/// 与「end_date 为今天」的假设不同，当前口径是：
/// - 自然周，周一起始（date-fns `weekStartsOn: 1`），不是滚动 today-6..today；
/// - 闭区间 `date >= from AND date <= to`；
/// - `to` 是本周周日，不是今天。今天早于周日时，周日仍算在本周内。
fn calendar_week(today: NaiveDate) -> (NaiveDate, NaiveDate) {
    let monday = today - Duration::days(today.weekday().num_days_from_monday() as i64);
    let sunday = monday + Duration::days(6);
    (monday, sunday)
}

fn date_str(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

async fn insert_study_log(pool: &SqlitePool, date: &str, duration_min: i64) {
    sqlx::query(
        "INSERT INTO actual_logs (date, duration_min, subject, method, tag_type)
         VALUES (?1, ?2, '数学', '刷题', 'study')",
    )
    .bind(date)
    .bind(duration_min)
    .execute(pool)
    .await
    .expect("insert actual_log");
}

/// 完成路径把 `session.date` 抄到 `actual_logs.date`。这里直接插入 done 场次和同日期流水。
async fn insert_done_study_log(pool: &SqlitePool, date: &str, duration_min: i64) {
    let task = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round)
           VALUES ('范围任务', 'main', '数学', '课', 10, 1, 1)"#,
    )
    .execute(pool)
    .await
    .expect("insert task");
    let session = sqlx::query(
        r#"INSERT INTO task_sessions
           (task_id, date, start_time, end_time, round, planned_units, actual_units, status)
           VALUES (?1, ?2, '09:00', '10:00', 1, 1, 1, 'done')"#,
    )
    .bind(task.last_insert_rowid())
    .bind(date)
    .execute(pool)
    .await
    .expect("insert done session");
    sqlx::query(
        "INSERT INTO actual_logs (date, duration_min, subject, method, tag_type, session_id)
         VALUES (?1, ?2, '数学', '刷题', 'study', ?3)",
    )
    .bind(date)
    .bind(duration_min)
    .bind(session.last_insert_rowid())
    .execute(pool)
    .await
    .expect("insert done actual_log");
}

async fn study_minutes(pool: &SqlitePool, from: &str, to: &str) -> i64 {
    let rows = stats_tag_type_totals_impl(pool, from, to)
        .await
        .expect("tag totals");
    rows.into_iter()
        .find(|row| row.tag_type == "study")
        .map(|row| row.duration_min)
        .unwrap_or(0)
}

/// 闭区间两端都计入：本周一 10、本周日 20。本周一的前一天（上周日）40 不计。
/// `to` 取本周周日，所以周日那条即使仍在未来也计入，不像 end_date=今天 那样被切掉。
#[tokio::test]
async fn week_range_boundary_inclusive() {
    let pool = common::setup().await;
    let today = Local::now().date_naive();
    let (monday, sunday) = calendar_week(today);
    let last_sunday = monday - Duration::days(1);

    insert_study_log(&pool, &date_str(monday), 10).await;
    insert_study_log(&pool, &date_str(sunday), 20).await;
    insert_study_log(&pool, &date_str(last_sunday), 40).await;

    let minutes = study_minutes(&pool, &date_str(monday), &date_str(sunday)).await;
    assert_eq!(
        minutes, 30,
        "monday {monday} (10) and sunday {sunday} (20) are inside [{monday}, {sunday}]; \
         last sunday {last_sunday} (40) is outside. today={today}, end is sunday not today"
    );
}

/// 本周范围由调用方传入周一..周日，SQL 用 `actual_logs.date`（完成时抄自 session.date）
/// 做闭区间过滤，不使用 `date('now')`。today-10 落在该周之外，不能被墙钟窗口卷进来。
/// 与 `balanced_window_uses_session_date_not_wall_clock` 同一探针；成就逻辑不在这里改。
#[tokio::test]
async fn week_range_uses_session_date_not_wall_clock() {
    let pool = common::setup().await;
    let today = Local::now().date_naive();
    let (monday, sunday) = calendar_week(today);
    let old = today - Duration::days(10);

    insert_done_study_log(&pool, &date_str(old), 15).await;

    let minutes = study_minutes(&pool, &date_str(monday), &date_str(sunday)).await;
    assert_eq!(
        minutes, 0,
        "log dated {old} (session.date, 10 days before today {today}) \
         stays outside calendar week [{monday}, {sunday}]"
    );
}

/// 周一起始：本周一计入，紧邻的上周日不计入。
/// 流水只写 `YYYY-MM-DD`，不写 00:00 / 23:59。
/// 前端 `weekStartsOn: 1` 已是周一起始；若改成周日起始，上周日会落进范围，本测试变红。
#[tokio::test]
async fn week_start_day_matches_definition() {
    let pool = common::setup().await;
    let today = Local::now().date_naive();
    let (monday, sunday) = calendar_week(today);
    let prev_sunday = monday - Duration::days(1);

    insert_study_log(&pool, &date_str(monday), 7).await;
    insert_study_log(&pool, &date_str(prev_sunday), 9).await;

    let minutes = study_minutes(&pool, &date_str(monday), &date_str(sunday)).await;
    assert_eq!(
        minutes, 7,
        "week starts Monday {monday}; previous Sunday {prev_sunday} is outside [{monday}, {sunday}]"
    );
}

/// 统计页「本月」同样由前端 `rangeFor` 算好再传入。
/// Rust 没有按年月查询的接口，也没有 chrono 月份加减。
///
/// 当前口径是自然月（1 日到月末），不是滚动 30 天：
/// - 闭区间，`to` 是月末，不是今天。当月未结束时，未来日期仍计入；
/// - 月末用「下月 1 日减一天」。12 月先把年进到次年 1 月，避免 `month + 1 == 13`。
fn calendar_month(today: NaiveDate) -> (NaiveDate, NaiveDate) {
    let first = NaiveDate::from_ymd_opt(today.year(), today.month(), 1).expect("day 1");
    let (next_year, next_month) = if today.month() == 12 {
        (today.year() + 1, 1)
    } else {
        (today.year(), today.month() + 1)
    };
    let first_of_next =
        NaiveDate::from_ymd_opt(next_year, next_month, 1).expect("day 1 of next month");
    (first, first_of_next - Duration::days(1))
}

/// 闭区间两端都计入：本月 1 日 10、本月最后一天 20。上月最后一天 40 不计。
/// `to` 取月末，所以最后一天即使仍在未来也计入，不像 end_date=今天 那样被切掉。
#[tokio::test]
async fn month_range_boundary_inclusive() {
    let pool = common::setup().await;
    let today = Local::now().date_naive();
    let (first, last) = calendar_month(today);
    let prev_last = first - Duration::days(1);

    insert_study_log(&pool, &date_str(first), 10).await;
    insert_study_log(&pool, &date_str(last), 20).await;
    insert_study_log(&pool, &date_str(prev_last), 40).await;

    let minutes = study_minutes(&pool, &date_str(first), &date_str(last)).await;
    assert_eq!(
        minutes, 30,
        "day 1 {first} (10) and month end {last} (20) are inside [{first}, {last}]; \
         previous month end {prev_last} (40) is outside. today={today}, end is month end not today"
    );
}

/// 没有「传入年月」的 stats 命令。这里用自然月闭区间调用 2025-12 与 2026-01，
/// 确认 12-31 与 01-01 不串月。范围在测试里用年月进位算出，12 月不会变成 13 月。
#[tokio::test]
async fn month_range_cross_year_safe() {
    let pool = common::setup().await;
    let dec = NaiveDate::from_ymd_opt(2025, 12, 15).expect("2025-12-15");
    let jan = NaiveDate::from_ymd_opt(2026, 1, 15).expect("2026-01-15");
    let (dec_from, dec_to) = calendar_month(dec);
    let (jan_from, jan_to) = calendar_month(jan);
    assert_eq!(date_str(dec_from), "2025-12-01");
    assert_eq!(date_str(dec_to), "2025-12-31");
    assert_eq!(date_str(jan_from), "2026-01-01");
    assert_eq!(date_str(jan_to), "2026-01-31");

    insert_study_log(&pool, "2025-12-31", 11).await;
    insert_study_log(&pool, "2026-01-01", 22).await;

    let december = study_minutes(&pool, &date_str(dec_from), &date_str(dec_to)).await;
    let january = study_minutes(&pool, &date_str(jan_from), &date_str(jan_to)).await;
    assert_eq!(december, 11, "2025-12-31 stays in December");
    assert_eq!(january, 22, "2026-01-01 stays in January");
}

/// 本月是自然月，不是从今天往前滚 30 天。上月 28 日常落在滚动 30 天里，但不应进本月。
#[tokio::test]
async fn month_does_not_use_rolling_30_days() {
    let pool = common::setup().await;
    let today = Local::now().date_naive();
    let (first, last) = calendar_month(today);
    let prev_last = first - Duration::days(1);
    let prev_28 = NaiveDate::from_ymd_opt(prev_last.year(), prev_last.month(), 28)
        .expect("previous month has a 28th");

    insert_study_log(&pool, &date_str(first), 10).await;
    insert_study_log(&pool, &date_str(prev_28), 40).await;

    let minutes = study_minutes(&pool, &date_str(first), &date_str(last)).await;
    assert_eq!(
        minutes, 10,
        "previous month 28th {prev_28} stays outside natural month [{first}, {last}] (today={today})"
    );
}

/// stats 没有独立的滚动 7 日查询。「本周」是自然周周一至周日，
/// balanced 是完成场次上的 `[session.date-6, session.date]`。
/// 未来的本周日在本周统计内、不在 balanced 内，两者不能交叉断言。
#[tokio::test]
#[ignore = "stats 没有独立 7 日范围；本周是自然周，与 balanced 的 [date-6, date] 不是同一窗口"]
async fn stats_range_matches_balanced_window_for_7_days() {}

/// `from > to` 不报错、不 panic。闭区间比较命中 0 行，返回空结果，也不把区间对调后查出数据。
#[tokio::test]
async fn stats_rejects_inverted_range() {
    let pool = common::setup().await;
    insert_done_study_log(&pool, "2026-11-04", 50).await;

    let from = "2026-11-10";
    let to = "2026-11-01";
    let totals = stats_tag_type_totals_impl(&pool, from, to)
        .await
        .expect("inverted tag totals stays Ok");
    assert!(
        totals.is_empty(),
        "inverted range must not return the 2026-11-04 log, got {totals:?}"
    );
    let share = stats_method_share_impl(&pool, from, to)
        .await
        .expect("inverted method share stays Ok");
    assert!(share.is_empty(), "got {share:?}");
    let planned = stats_plan_vs_actual_impl(&pool, from, to)
        .await
        .expect("inverted plan vs actual stays Ok");
    assert!(planned.is_empty(), "got {planned:?}");
    let rate = stats_completion_rate_impl(&pool, from, to)
        .await
        .expect("inverted completion rate stays Ok");
    assert_eq!(rate.done, 0);
    assert_eq!(rate.missed, 0);
    assert_eq!(rate.rescheduled, 0);
    assert_eq!(rate.rate, 0.0);
}

/// 空窗口返回空结构或 0。达成率分母为 0 时 `rate = 0.0`，不做除法。
/// method 占比返回分钟行；没有行就没有分母，Rust 不计算百分比。
/// 计划 vs 实际只返回两个分钟合计。计划为 0、实际大于 0 时不计算比值。
#[tokio::test]
async fn stats_handles_empty_range() {
    let pool = common::setup().await;
    let from = "1999-01-01";
    let to = "1999-01-02";

    let totals = stats_tag_type_totals_impl(&pool, from, to)
        .await
        .expect("empty tag totals");
    assert!(totals.is_empty(), "got {totals:?}");

    let share = stats_method_share_impl(&pool, from, to)
        .await
        .expect("empty method share");
    let denom: i64 = share.iter().map(|row| row.duration_min).sum();
    assert!(share.is_empty(), "got {share:?}");
    assert_eq!(denom, 0, "no study rows means the method denominator is 0");

    let rate = stats_completion_rate_impl(&pool, from, to)
        .await
        .expect("empty completion rate");
    assert_eq!(rate.done + rate.missed + rate.rescheduled, 0);
    assert_eq!(rate.rate, 0.0);
    assert!(rate.rate.is_finite());

    insert_study_log(&pool, "2026-03-01", 45).await;
    let rows = stats_plan_vs_actual_impl(&pool, "2026-03-01", "2026-03-01")
        .await
        .expect("planned zero still returns Ok");
    assert_eq!(rows.len(), 1, "got {rows:?}");
    assert_eq!(rows[0].planned_min, 0);
    assert_eq!(rows[0].actual_min, 45);
}

/// 查询参数里可解析的未补零日期先规范成 `YYYY-MM-DD`，再做文本比较。
/// `"2026-1-1"` 因此命中库存的 `"2026-01-01"`。不能解析的字符串原样比较，不返回 Err。
/// 与 `normalize_hhmm`（`"9:00"` → `"09:00"`）同一口径：能解析就补零，不拒绝。
#[tokio::test]
async fn stats_date_format_strict() {
    let pool = common::setup().await;
    insert_study_log(&pool, "2026-01-01", 12).await;
    insert_study_log(&pool, "2026-01-02", 9).await;

    let minutes = study_minutes(&pool, "2026-1-1", "2026-1-1").await;
    assert_eq!(
        minutes, 12,
        "2026-1-1 is normalized to 2026-01-01 and matches that row only"
    );
}
