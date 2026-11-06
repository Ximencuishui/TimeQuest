mod common;

use timequest_lib::create_session_impl;

async fn insert_task(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round, color)
           VALUES ('重叠测试', 'main', '数学', '课', 10, 1, 1, '#F97316')"#,
    )
    .execute(pool)
    .await
    .expect("insert task")
    .last_insert_rowid()
}

/// Same predicate as `find_overlaps`: TEXT `<` on the stored/query strings.
async fn text_overlap_ids(
    pool: &sqlx::SqlitePool,
    date: &str,
    start_time: &str,
    end_time: &str,
    exclude_id: i64,
) -> Vec<i64> {
    sqlx::query_scalar(
        "SELECT s.id FROM task_sessions s
         WHERE s.date = ?1 AND s.status = 'planned'
           AND s.start_time < ?3 AND ?2 < s.end_time
           AND s.id != ?4",
    )
    .bind(date)
    .bind(start_time)
    .bind(end_time)
    .bind(exclude_id)
    .fetch_all(pool)
    .await
    .expect("overlap query")
}

/// 漏报组：A = 9:00–10:00，B = 9:30–10:00。时钟上 B 落在 A 内。
/// `find_overlaps` 的文本比较必须命中 A。未补零时 `'9' > '1'`，`"9:00" < "10:00"` 为假。
#[tokio::test]
async fn overlap_unpadded_hour_is_not_a_text_hit() {
    let pool = common::setup().await;
    let task_id = insert_task(&pool).await;
    let date = "2026-11-04".to_string();

    let a = create_session_impl(
        &pool,
        task_id,
        date.clone(),
        "9:00".into(),
        "10:00".into(),
        Some(1),
        Some(1),
    )
    .await
    .expect("session A");

    let b = create_session_impl(
        &pool,
        task_id,
        date.clone(),
        "9:30".into(),
        "10:00".into(),
        Some(1),
        Some(1),
    )
    .await;

    assert!(b.is_ok(), "create_session_impl must return Ok, got {b:?}");
    let b = b.unwrap();

    let hits = text_overlap_ids(&pool, &date, &b.start_time, &b.end_time, b.id).await;
    assert!(
        hits.contains(&a.id),
        "漏报: A {} start={} end={} vs B start={} end={} text hits={hits:?}",
        a.id,
        a.start_time,
        a.end_time,
        b.start_time,
        b.end_time
    );

    let starts: Vec<String> =
        sqlx::query_scalar("SELECT start_time FROM task_sessions WHERE date = ?1 ORDER BY id")
            .bind(&date)
            .fetch_all(&pool)
            .await
            .expect("read start_time");
    assert!(
        starts.iter().all(|s| s.len() == 5),
        "stored start_time must be HH:MM (len == 5), got {starts:?}"
    );
}
