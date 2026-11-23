//! 4.0 升级前后的行为等价护栏。
//!
//! 4.0 把成绩从「一场一行六列」拆成「场次 + 成绩行」，演示数据也跟着换了写法。
//! 拆开是为了让赛道/科目可变，但同一份种子数据在升级前后必须给出同一个数：
//! 成绩页的折算总分、统计页的各科分钟数与达成率都要逐位一致。
//!
//! 这里钉的是「演示数据」这条最容易被用户直接看到的路径。

use rusqlite::{params, Connection};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::path::PathBuf;
use timequest_lib::{
    generate_mock_data_impl, stats_completion_rate_impl, stats_plan_vs_actual_impl,
};

/// 4.0 之前的演示成绩（`exam_records` 六列）就是这两个数。
const LEGACY_DEMO_SCORES: &[(&str, &[f64])] = &[
    (
        "高二上期中",
        &[105.0, 118.0, 112.0, 68.0, 71.0, 74.0],
    ),
    (
        "高二月考",
        &[110.0, 124.0, 115.0, 73.0, 69.0, 76.0],
    ),
];

/// 4.0 之前演示数据的各科计划分钟数（按 session 时长合计）。
const LEGACY_DEMO_PLANNED_MIN: &[(&str, i64)] = &[("数学", 120), ("物理", 60), ("英语", 60)];

fn temp_path() -> PathBuf {
    let path = std::env::temp_dir().join(format!("timequest-parity-{}.db", uuid::Uuid::new_v4()));
    let _ = std::fs::remove_file(&path);
    path
}

async fn migrate_and_open(path: &PathBuf) -> Connection {
    let url = format!(
        "sqlite:{}?mode=rwc",
        path.to_string_lossy().replace('\\', "/")
    );
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect temp sqlite");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("pragma");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("migrate");
    pool.close().await;

    let conn = Connection::open(path).expect("rusqlite open");
    conn.execute_batch("PRAGMA foreign_keys = ON;").expect("pragma");
    conn
}

async fn open_pool(path: &PathBuf) -> SqlitePool {
    let url = format!(
        "sqlite:{}?mode=rwc",
        path.to_string_lossy().replace('\\', "/")
    );
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect pool");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("pragma");
    pool
}

/// 取一场演示考试的成绩，按 `subjects.order_index` 排。
fn demo_scores(conn: &Connection, exam_name: &str) -> Vec<(String, f64)> {
    let mut stmt = conn
        .prepare(
            "SELECT s.key, es.score FROM exam_scores es
             JOIN subjects s ON s.id = es.subject_id
             JOIN exam_sessions e ON e.id = es.exam_id
             WHERE e.name = ?1 ORDER BY s.order_index",
        )
        .expect("prepare");
    let rows = stmt
        .query_map(params![exam_name], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        })
        .expect("query");
    rows.map(|row| row.expect("row")).collect()
}

#[tokio::test]
async fn mock_demo_scores_match_the_pre_4_0_baseline() {
    let path = temp_path();
    let conn = migrate_and_open(&path).await;

    generate_mock_data_impl(&conn).expect("generate demo data");

    for (name, expected) in LEGACY_DEMO_SCORES {
        let rows = demo_scores(&conn, name);
        assert_eq!(rows.len(), 6, "{name} 应展开六行成绩");
        let keys: Vec<&str> = rows.iter().map(|(key, _)| key.as_str()).collect();
        assert_eq!(
            keys,
            vec!["chinese", "math", "english", "physics", "chemistry", "biology"],
            "{name} 的科目顺序与升级前一致"
        );
        let values: Vec<f64> = rows.iter().map(|(_, score)| *score).collect();
        assert_eq!(&values, expected, "{name} 的分数与升级前逐位一致");

        // 六科全齐时折算总分就是实考总分（升级前的口径）。
        let sum: f64 = values.iter().sum();
        assert_eq!(sum, expected.iter().sum::<f64>());
    }

    drop(conn);
    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn mock_demo_minutes_and_rate_match_the_pre_4_0_baseline() {
    let path = temp_path();
    let conn = migrate_and_open(&path).await;

    generate_mock_data_impl(&conn).expect("generate demo data");
    drop(conn);

    let pool = open_pool(&path).await;
    let today = chrono::Local::now()
        .date_naive()
        .format("%Y-%m-%d")
        .to_string();

    // 各科计划分钟数：升级前是同一份 session 时长，按科目分组的结果一样。
    let plan_vs_actual = stats_plan_vs_actual_impl(&pool, &today, &today)
        .await
        .expect("plan vs actual");
    let planned: Vec<(String, i64)> = plan_vs_actual
        .iter()
        .map(|row| (row.subject.clone(), row.planned_min))
        .collect();
    let expected_planned: Vec<(String, i64)> = LEGACY_DEMO_PLANNED_MIN
        .iter()
        .map(|(subject, minutes)| (subject.to_string(), *minutes))
        .collect();
    assert_eq!(planned, expected_planned, "各科计划分钟数与升级前逐位一致");

    // 演示数据不带流水，实际分钟数全为 0。
    for row in &plan_vs_actual {
        assert_eq!(row.actual_min, 0, "{} 没有流水", row.subject);
    }

    // 达成率：分母只算 done/missed/rescheduled，演示数据有 2 场 done。
    let rate = stats_completion_rate_impl(&pool, &today, &today)
        .await
        .expect("completion rate");
    assert_eq!(rate.done, 2);
    assert_eq!(rate.missed, 0);
    assert_eq!(rate.rescheduled, 0);
    assert_eq!(rate.rate, 1.0, "达成率与升级前逐位一致");

    pool.close().await;
    let _ = std::fs::remove_file(&path);
}
