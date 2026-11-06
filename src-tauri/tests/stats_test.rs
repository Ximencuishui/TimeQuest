mod common;

use std::collections::BTreeMap;

use chrono::Local;
use sqlx::SqlitePool;
use timequest_lib::{
    complete_session_impl, stats_daily_units_impl, stats_method_share_impl,
    stats_plan_vs_actual_impl, stats_tag_type_totals_impl,
};

const DAY: &str = "2026-11-04";

async fn insert_log(
    pool: &SqlitePool,
    duration_min: i64,
    subject: Option<&str>,
    method: Option<&str>,
    tag_type: &str,
) {
    sqlx::query(
        "INSERT INTO actual_logs (date, duration_min, subject, method, tag_type)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(DAY)
    .bind(duration_min)
    .bind(subject)
    .bind(method)
    .bind(tag_type)
    .execute(pool)
    .await
    .expect("insert actual_log");
}

fn totals_map(rows: Vec<timequest_lib::TagTypeRow>) -> BTreeMap<String, i64> {
    rows.into_iter()
        .map(|row| (row.tag_type, row.duration_min))
        .collect()
}

/// `stats_tag_type_totals` groups `SUM(duration_min)` by `tag_type` inside
/// `date >= from AND date <= to`. No status column on `actual_logs`.
#[tokio::test]
async fn tag_type_totals_sum_duration_without_mixing_tags() {
    let pool = common::setup().await;
    insert_log(&pool, 60, Some("数学"), Some("刷题"), "study").await;
    insert_log(&pool, 30, None, None, "sport").await;
    insert_log(&pool, 20, None, None, "game").await;

    let rows = stats_tag_type_totals_impl(&pool, DAY, DAY)
        .await
        .expect("tag totals");
    let totals = totals_map(rows);

    assert_eq!(totals.get("study").copied(), Some(60));
    assert_eq!(totals.get("sport").copied(), Some(30));
    assert_eq!(totals.get("game").copied(), Some(20));
    assert_eq!(
        totals.len(),
        3,
        "only tags that have rows in the window belong in the result, got {totals:?}"
    );
}

/// `stats_method_share` keeps `tag_type = 'study'` only. The returned rows are
/// minute sums; their total is the study denominator (100), not all tags (150).
#[tokio::test]
async fn method_share_only_counts_study_tag() {
    let pool = common::setup().await;
    insert_log(&pool, 40, Some("数学"), Some("听课"), "study").await;
    insert_log(&pool, 60, Some("数学"), Some("刷题"), "study").await;
    insert_log(&pool, 30, None, None, "sport").await;
    insert_log(&pool, 20, None, None, "game").await;

    let rows = stats_method_share_impl(&pool, DAY, DAY)
        .await
        .expect("method share");
    let denom: i64 = rows.iter().map(|row| row.duration_min).sum();
    assert_eq!(denom, 100, "denominator is study minutes, not 40+60+30+20");

    let minutes = |method: &str| {
        rows.iter()
            .find(|row| row.method == method)
            .map(|row| row.duration_min)
            .unwrap_or_else(|| panic!("missing method {method} in {rows:?}"))
    };
    assert_eq!(minutes("听课") * 100 / denom, 40);
    assert_eq!(minutes("刷题") * 100 / denom, 60);
    assert!(
        rows.iter()
            .all(|row| row.method == "听课" || row.method == "刷题"),
        "sport/game must stay out of method share, got {rows:?}"
    );
}

/// `complete_session_impl` inserts `tag_type='study'` and `method='刷题'`.
/// The completion dialog's method is applied later by the `complete_session`
/// command (`UPDATE actual_logs SET method`), which this impl does not take.
#[tokio::test]
async fn completion_writes_study_tag_by_default() {
    let pool = common::setup().await;
    let task = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round)
           VALUES ('完成写流水', 'main', '数学', '课', 10, 1, 1)"#,
    )
    .execute(&pool)
    .await
    .expect("insert task");
    let session = sqlx::query(
        r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, planned_units, status)
           VALUES (?1, ?2, '09:00', '10:00', 1, 2, 'planned')"#,
    )
    .bind(task.last_insert_rowid())
    .bind(DAY)
    .execute(&pool)
    .await
    .expect("insert session");
    let session_id = session.last_insert_rowid();

    complete_session_impl(
        &pool,
        session_id,
        2,
        Some(3),
        None,
        false,
        Local::now(),
        None,
    )
    .await
    .expect("complete session");

    let logged: Vec<(String, String)> =
        sqlx::query_as("SELECT tag_type, method FROM actual_logs WHERE session_id = ?1")
            .bind(session_id)
            .fetch_all(&pool)
            .await
            .expect("read actual_logs");
    assert_eq!(logged, vec![("study".to_string(), "刷题".to_string())]);
}

/// Manual rows come from `create_log`, which writes `tag_type` from the payload
/// and leaves `session_id` null. Stats still see that row.
#[tokio::test]
async fn manual_log_respects_selected_tag_type() {
    let pool = common::setup().await;
    insert_log(&pool, 30, None, None, "sport").await;

    let totals = totals_map(
        stats_tag_type_totals_impl(&pool, DAY, DAY)
            .await
            .expect("tag totals"),
    );
    assert_eq!(totals.get("sport").copied(), Some(30));
    assert_eq!(totals.len(), 1, "unexpected tags: {totals:?}");

    let share = stats_method_share_impl(&pool, DAY, DAY)
        .await
        .expect("method share");
    let denom: i64 = share.iter().map(|row| row.duration_min).sum();
    assert_eq!(
        denom, 0,
        "sport duration must not enter the method-share denominator, got {share:?}"
    );
}

/// C 段：科目聚合在 `stats_plan_vs_actual`（`GROUP BY COALESCE(subject,'未分类')`），
/// 开放原串、无枚举过滤。`stats_tag_type_totals` 只按 `tag_type`，不能锁科目。
/// 锁「自定义 subject 不静默消失」，防日后加白名单。
#[tokio::test]
async fn unknown_subject_stays_in_plan_vs_actual() {
    let pool = common::setup().await;
    insert_log(&pool, 30, Some("数学"), Some("刷题"), "study").await;
    insert_log(&pool, 20, Some("自选专题A"), Some("整理"), "study").await;
    insert_log(&pool, 10, None, None, "study").await;

    let rows = stats_plan_vs_actual_impl(&pool, DAY, DAY)
        .await
        .expect("plan vs actual");
    let by_subject: BTreeMap<String, i64> = rows
        .iter()
        .map(|r| (r.subject.clone(), r.actual_min))
        .collect();

    assert_eq!(
        by_subject.get("自选专题A").copied(),
        Some(20),
        "custom subject must remain its own group, got {rows:?}"
    );
    // 选择：SQL `COALESCE(subject, '未分类')`，NULL 归入「未分类」，不是独立 NULL 组。
    assert_eq!(
        by_subject.get("未分类").copied(),
        Some(10),
        "NULL subject → '未分类', got {rows:?}"
    );
    assert_eq!(by_subject.get("数学").copied(), Some(30));

    let total_actual: i64 = rows.iter().map(|r| r.actual_min).sum();
    assert_eq!(
        total_actual, 60,
        "unknown subject must not shrink the actual total, got {rows:?}"
    );
}

/// C 段：`stats_method_share` 对 study 行 `GROUP BY COALESCE(method,'未填')`，
/// 未知 method 自成一组，不归「其他」、不丢弃。
#[tokio::test]
async fn unknown_method_stays_in_method_share() {
    let pool = common::setup().await;
    insert_log(&pool, 40, Some("数学"), Some("听课"), "study").await;
    insert_log(&pool, 60, Some("数学"), Some("刷题"), "study").await;
    insert_log(&pool, 30, Some("数学"), Some("自创方式B"), "study").await;

    let rows = stats_method_share_impl(&pool, DAY, DAY)
        .await
        .expect("method share");
    let denom: i64 = rows.iter().map(|r| r.duration_min).sum();
    assert_eq!(
        denom, 130,
        "denominator must include unknown method, got {rows:?}"
    );

    let custom = rows
        .iter()
        .find(|r| r.method == "自创方式B")
        .unwrap_or_else(|| panic!("自创方式B missing from {rows:?}"));
    assert_eq!(custom.duration_min, 30);
    assert_eq!(custom.duration_min * 130 / denom, 30);
}

/// C 段第 4 条：subject/method **不做 trim**。开放字符串，用户需自行保持一致。
/// 产品若要合并尾随空格，属另一次变更（加 trim 或迁移），不在本护栏。
#[tokio::test]
async fn subject_whitespace_is_not_normalized() {
    let pool = common::setup().await;
    insert_log(&pool, 15, Some("数学"), Some("刷题"), "study").await;
    insert_log(&pool, 25, Some("数学 "), Some("刷题"), "study").await;

    let rows = stats_plan_vs_actual_impl(&pool, DAY, DAY)
        .await
        .expect("plan vs actual");
    let by_subject: BTreeMap<String, i64> = rows
        .iter()
        .map(|r| (r.subject.clone(), r.actual_min))
        .collect();

    assert_eq!(
        by_subject.get("数学").copied(),
        Some(15),
        "exact '数学' group, got {rows:?}"
    );
    assert_eq!(
        by_subject.get("数学 ").copied(),
        Some(25),
        "trailing-space subject must stay a separate group (no trim), got {rows:?}"
    );
    assert_eq!(
        by_subject.len(),
        2,
        "expected two subject keys, got {by_subject:?}"
    );
}

/// Done sessions on the same date add their `actual_units`. Planned / missed units
/// and `actual_logs` minutes stay out of the brick totals.
#[tokio::test]
async fn daily_units_sum_done_sessions_and_ignore_logs() {
    let pool = common::setup().await;
    let task_id: i64 =
        sqlx::query_scalar("INSERT INTO tasks (title, type) VALUES ('墙', 'main') RETURNING id")
            .fetch_one(&pool)
            .await
            .expect("insert task");

    let insert = |date: &str, status: &str, units: i64| {
        let pool = &pool;
        let date = date.to_string();
        let status = status.to_string();
        async move {
            sqlx::query(
                "INSERT INTO task_sessions
                   (task_id, date, start_time, end_time, status, planned_units, actual_units)
                 VALUES (?1, ?2, '09:00', '10:00', ?3, ?4, ?5)",
            )
            .bind(task_id)
            .bind(date)
            .bind(status)
            .bind(units)
            .bind(units)
            .execute(pool)
            .await
            .expect("insert session");
        }
    };
    insert("2026-01-02", "done", 2).await;
    insert("2026-01-02", "done", 3).await;
    insert("2026-01-02", "planned", 9).await;
    insert("2026-01-03", "done", 0).await;
    insert("2026-01-04", "missed", 4).await;
    insert("2025-12-01", "done", 8).await;
    sqlx::query(
        "INSERT INTO actual_logs (date, duration_min, tag_type) VALUES ('2026-01-05', 60, 'study')",
    )
    .execute(&pool)
    .await
    .expect("insert log");

    let rows = stats_daily_units_impl(&pool, "2026-01-01", "2026-01-07")
        .await
        .expect("daily units");
    let totals: BTreeMap<String, i64> = rows.into_iter().map(|row| (row.date, row.units)).collect();
    assert_eq!(totals.get("2026-01-02").copied(), Some(5));
    assert_eq!(totals.get("2026-01-03").copied(), Some(0));
    assert!(
        totals.get("2026-01-04").is_none(),
        "missed units must not paint a brick"
    );
    assert!(
        totals.get("2026-01-05").is_none(),
        "logs have minutes, not units"
    );
    assert!(totals.get("2025-12-01").is_none(), "outside the range");
}
