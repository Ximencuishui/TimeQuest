//! 旧库升级：六科扁平的 `exam_records` 展开成「场次 + 成绩行」。
//!
//! 覆盖：成绩行数正确、`subjects` 六行、目标存在、`foreign_key_check` 干净、
//! 迁移重复执行幂等、旧表只读留档。

use rusqlite::{params, Connection};
use sqlx::migrate::Migrate;
use sqlx::sqlite::SqliteConnection;
use sqlx::Connection as SqlxConnection;
use std::path::PathBuf;
use timequest_lib::{
    list_exam_sessions_impl, list_goals_impl, list_subjects_impl, seed_default_goal_impl,
};

/// 成绩行化那条迁移的版本号。
const SPLIT_MIGRATION: i64 = 20261123010000;
/// 迁移原文。重复执行一次，用来看它是不是幂等。
const SPLIT_SQL: &str = include_str!("../migrations/20261123010000_split_exam_records.sql");

fn temp_path(label: &str) -> PathBuf {
    let path =
        std::env::temp_dir().join(format!("timequest-migration-{label}-{}.db", uuid::Uuid::new_v4()));
    let _ = std::fs::remove_file(&path);
    path
}

fn url_for(path: &PathBuf) -> String {
    format!(
        "sqlite:{}?mode=rwc",
        path.to_string_lossy().replace('\\', "/")
    )
}

/// 只跑版本号 ≤ `max_version` 的迁移。
async fn apply_up_to(
    conn: &mut SqliteConnection,
    migrator: &sqlx::migrate::Migrator,
    max_version: i64,
) {
    conn.ensure_migrations_table().await.expect("migrations table");
    for migration in migrator.iter() {
        if migration.version <= max_version {
            conn.apply(migration).await.expect("apply migration");
        }
    }
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).expect("count")
}

fn score_of(conn: &Connection, exam_id: i64, key: &str) -> Option<f64> {
    conn.query_row(
        "SELECT es.score FROM exam_scores es
         JOIN subjects s ON s.id = es.subject_id
         WHERE es.exam_id = ?1 AND s.key = ?2",
        params![exam_id, key],
        |r| r.get(0),
    )
    .expect("score row")
}

#[tokio::test]
async fn legacy_exam_records_expand_into_sessions_and_score_rows() {
    let path = temp_path("split");
    let url = url_for(&path);
    let mut conn = SqlxConnection::connect(&url).await.expect("connect");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&mut conn)
        .await
        .expect("pragma");

    let migrator = sqlx::migrate!("./migrations");
    // 先只跑到成绩行化之前 —— 这就是 4.0 之前的库。
    apply_up_to(&mut conn, &migrator, SPLIT_MIGRATION - 1).await;

    sqlx::query(
        "INSERT INTO exam_records (
             id, exam_name, exam_date, chinese_score, math_score, english_score,
             physics_score, chemistry_score, biology_score, created_at, is_mock
           ) VALUES (1, '一模', '2026-10-08', 100, 120, 110, 60, NULL, NULL, '2026-10-08 12:00:00', 0)",
    )
    .execute(&mut conn)
    .await
    .expect("seed legacy row 1");
    sqlx::query(
        "INSERT INTO exam_records (
             id, exam_name, exam_date, chinese_score, math_score, english_score,
             physics_score, chemistry_score, biology_score, created_at, is_mock
           ) VALUES (2, '二模', '2026-11-08', 105, 125, 115, 65, 70, 75, '2026-11-08 12:00:00', 0)",
    )
    .execute(&mut conn)
    .await
    .expect("seed legacy row 2");
    sqlx::query("UPDATE user_profile SET subject_targets = ?1 WHERE id = 1")
        .bind(r#"{"chinese":110,"math":125,"english":115,"physics":70,"chemistry":70,"biology":75}"#)
        .execute(&mut conn)
        .await
        .expect("seed profile");

    // 升级到最新。
    migrator
        .run(&mut conn)
        .await
        .expect("run remaining migrations");
    conn.close().await.expect("close");

    let conn = Connection::open(&path).expect("rusqlite open");

    // 科目字典：六行，满分与老档案一致。
    let subjects = list_subjects_impl(&conn, None).expect("subjects");
    assert_eq!(subjects.len(), 6);
    assert_eq!(subjects[0].key, "chinese");
    assert_eq!(subjects[1].full_mark, Some(130.0));
    assert_eq!(subjects[5].key, "biology");

    // 两场考试 → 两行场次。
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM exam_sessions"), 2);
    let sessions = list_exam_sessions_impl(&conn).expect("sessions");
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0].id, 2, "日期新的在前");
    assert_eq!(sessions[1].id, 1);
    assert_eq!(sessions[1].name, "一模");
    assert_eq!(sessions[1].date, "2026-10-08");

    // 每场展开六行成绩，没考的也是一行（NULL）。
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM exam_scores"), 12);
    assert_eq!(score_of(&conn, 1, "chinese"), Some(100.0));
    assert_eq!(score_of(&conn, 1, "chemistry"), None);
    assert_eq!(score_of(&conn, 1, "biology"), None);
    assert_eq!(score_of(&conn, 2, "biology"), Some(75.0));

    // 外键没有悬空。
    let violations: i64 = count(&conn, "SELECT COUNT(*) FROM pragma_foreign_key_check");
    assert_eq!(violations, 0, "foreign_key_check 必须干净");

    // 旧表只读留档，行还在。
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM exam_records"), 2);

    // 目标表在，播种后有一条主目标。
    seed_default_goal_impl(&conn).expect("seed goal");
    let goals = list_goals_impl(&conn).expect("goals");
    assert_eq!(goals.len(), 1);
    assert!(goals[0].is_primary);

    // 迁移重复执行幂等：再跑一遍 SQL，行数不变。
    conn.execute_batch(SPLIT_SQL).expect("re-run migration sql");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM exam_sessions"), 2);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM exam_scores"), 12);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM subjects"), 6);

    let _ = std::fs::remove_file(&path);
}

/// 旧库升级：档案里的六科目标搬到 `subjects.goal`，与升级前一致。
///
/// `user_profile.subject_targets` 是 3.x 的权威值；升级后科目字典里的 `goal`
/// 才是权威源，但搬过来的数值必须一样，用户看到的设置页才没变。
#[tokio::test]
async fn legacy_subject_targets_move_into_the_subject_dictionary() {
    let path = temp_path("subject-targets");
    let url = url_for(&path);
    let mut conn = SqlxConnection::connect(&url).await.expect("connect");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&mut conn)
        .await
        .expect("pragma");

    let migrator = sqlx::migrate!("./migrations");
    // 先只跑到成绩行化之前 —— 这就是 4.0 之前的库。
    apply_up_to(&mut conn, &migrator, SPLIT_MIGRATION - 1).await;

    sqlx::query("UPDATE user_profile SET subject_targets = ?1, total_target = ?2 WHERE id = 1")
        .bind(r#"{"chinese":110,"math":125,"english":115,"physics":70,"chemistry":70,"biology":75}"#)
        .bind(565_i64)
        .execute(&mut conn)
        .await
        .expect("seed profile");

    migrator
        .run(&mut conn)
        .await
        .expect("run remaining migrations");
    conn.close().await.expect("close");

    let conn = Connection::open(&path).expect("rusqlite open");

    // 六科目标与升级前一模一样。
    let subjects = list_subjects_impl(&conn, None).expect("subjects");
    assert_eq!(subjects.len(), 6);
    let goals: Vec<(&str, Option<f64>)> = subjects
        .iter()
        .map(|subject| (subject.key.as_str(), subject.goal))
        .collect();
    assert_eq!(goals[0], ("chinese", Some(110.0)));
    assert_eq!(goals[1], ("math", Some(125.0)));
    assert_eq!(goals[2], ("english", Some(115.0)));
    assert_eq!(goals[3], ("physics", Some(70.0)));
    assert_eq!(goals[4], ("chemistry", Some(70.0)));
    assert_eq!(goals[5], ("biology", Some(75.0)));

    // 总分目标也搬到主目标上。
    seed_default_goal_impl(&conn).expect("seed goal");
    let primary = list_goals_impl(&conn)
        .expect("goals")
        .into_iter()
        .find(|goal| goal.is_primary)
        .expect("primary goal");
    assert_eq!(primary.target_score, Some(565.0));

    let _ = std::fs::remove_file(&path);
}
