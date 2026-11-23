//! 成绩行化：场次 + 每科一行成绩。
//!
//! 覆盖：多行成绩写入、`score` 是 REAL（能存 6.5）、负分拒绝、
//! NULL = 这场没考这科、删场次连带删成绩、导出导入往返。

use rusqlite::{params, Connection};
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use timequest_lib::{
    create_exam_session_impl, delete_exam_session_impl, export_json_impl, import_json_impl,
    list_exam_sessions_impl, list_subjects_impl, CreateExamSessionPayload, ExamScoreInput,
};

async fn open_rusqlite_migrated() -> (PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("timequest-scores-{}.db", uuid::Uuid::new_v4()));
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    let path_str = path.to_string_lossy().replace('\\', "/");
    let url = format!("sqlite:{path_str}?mode=rwc");
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

    let conn = Connection::open(&path).expect("rusqlite open");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("pragma foreign_keys");
    (path, conn)
}

fn payload(name: &str, date: &str, scores: &[(&str, Option<f64>)]) -> CreateExamSessionPayload {
    CreateExamSessionPayload {
        track_id: None,
        name: name.to_string(),
        date: date.to_string(),
        scores: scores
            .iter()
            .map(|(key, score)| ExamScoreInput {
                subject_key: key.to_string(),
                score: *score,
            })
            .collect(),
    }
}

/// 六科里除了生物都考了。
fn five_subjects() -> Vec<(&'static str, Option<f64>)> {
    vec![
        ("chinese", Some(110.0)),
        ("math", Some(130.0)),
        ("english", Some(115.0)),
        ("physics", Some(70.0)),
        ("chemistry", Some(75.0)),
        ("biology", None),
    ]
}

fn subject_id(conn: &Connection, key: &str) -> i64 {
    conn.query_row(
        "SELECT id FROM subjects WHERE key = ?1",
        params![key],
        |r| r.get(0),
    )
    .expect("subject row")
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
async fn seed_subjects_are_six_with_the_documented_full_marks() {
    let (path, conn) = open_rusqlite_migrated().await;
    let subjects = list_subjects_impl(&conn).expect("list subjects");
    assert_eq!(subjects.len(), 6);
    assert_eq!(subjects[0].key, "chinese");
    assert_eq!(subjects[0].label, "语文");
    assert_eq!(subjects[0].full_mark, Some(120.0));
    assert_eq!(subjects[0].goal, Some(120.0));
    assert_eq!(subjects[1].key, "math");
    assert_eq!(subjects[1].full_mark, Some(130.0));
    assert_eq!(subjects[5].key, "biology");
    assert_eq!(subjects[5].full_mark, Some(80.0));
    let total: f64 = subjects.iter().map(|s| s.full_mark.unwrap_or(0.0)).sum();
    assert_eq!(total, 610.0);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn exam_session_stores_one_row_per_subject_and_lists_newest_first() {
    let (path, conn) = open_rusqlite_migrated().await;

    let err = create_exam_session_impl(&conn, payload("   ", "2026-11-06", &five_subjects()))
        .expect_err("blank name");
    assert!(err.contains("考试名称"), "got {err}");
    assert!(list_exam_sessions_impl(&conn).unwrap().is_empty());

    let negative = payload("期中", "2026-11-06", &[("math", Some(-1.0))]);
    let err = create_exam_session_impl(&conn, negative).expect_err("negative score");
    assert!(err.contains("数学"), "got {err}");
    assert!(list_exam_sessions_impl(&conn).unwrap().is_empty());

    let blank = payload("空卷", "2026-11-06", &[("chinese", None), ("math", None)]);
    let err = create_exam_session_impl(&conn, blank).expect_err("every subject empty");
    assert!(err.contains("至少填写一科"), "got {err}");

    let unknown = payload("陌生科目", "2026-11-06", &[("astrophysics", Some(10.0))]);
    let err = create_exam_session_impl(&conn, unknown).expect_err("unknown subject");
    assert!(err.contains("astrophysics"), "got {err}");

    let first = create_exam_session_impl(
        &conn,
        payload("  2026届高三上期中考  ", "2026-11-1", &five_subjects()),
    )
    .expect("create partial");
    assert_eq!(first.name, "2026届高三上期中考");
    assert_eq!(first.date, "2026-11-01");
    assert_eq!(first.scores.len(), 6, "没考的科目也留一行");
    assert_eq!(score_of(&conn, first.id, "chinese"), Some(110.0));
    assert_eq!(score_of(&conn, first.id, "biology"), None, "没考就是 NULL，不是 0");

    let mut full = five_subjects();
    full[5] = ("biology", Some(80.0));
    let second = create_exam_session_impl(&conn, payload("月考", "2026-11-20", &full))
        .expect("later exam");

    let listed = list_exam_sessions_impl(&conn).expect("list");
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, second.id, "later date comes first");
    assert_eq!(listed[1].id, first.id);
    assert_eq!(score_of(&conn, second.id, "biology"), Some(80.0));

    delete_exam_session_impl(&conn, first.id).expect("delete");
    let after = list_exam_sessions_impl(&conn).unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].id, second.id);
    let missing = delete_exam_session_impl(&conn, first.id).expect_err("already gone");
    assert!(missing.contains("不存在"), "got {missing}");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn exam_score_is_real_so_fractions_survive() {
    let (path, conn) = open_rusqlite_migrated().await;

    let created = create_exam_session_impl(
        &conn,
        payload("口语", "2026-11-06", &[("english", Some(6.5))]),
    )
    .expect("create");
    assert_eq!(score_of(&conn, created.id, "english"), Some(6.5));

    let listed = list_exam_sessions_impl(&conn).expect("list");
    assert_eq!(listed[0].scores.len(), 1);
    assert_eq!(listed[0].scores[0].score, Some(6.5));
    assert_eq!(listed[0].scores[0].subject_id, subject_id(&conn, "english"));

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn deleting_a_session_removes_its_score_rows() {
    let (path, conn) = open_rusqlite_migrated().await;

    let created = create_exam_session_impl(&conn, payload("期中", "2026-11-06", &five_subjects()))
        .expect("create");
    let rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM exam_scores WHERE exam_id = ?1",
            params![created.id],
            |r| r.get(0),
        )
        .expect("count");
    assert_eq!(rows, 6);

    delete_exam_session_impl(&conn, created.id).expect("delete");
    let left: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM exam_scores WHERE exam_id = ?1",
            params![created.id],
            |r| r.get(0),
        )
        .expect("count");
    assert_eq!(left, 0, "成绩行跟着场次一起没了");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn export_import_round_trip_keeps_sessions_and_scores() {
    let (path, conn) = open_rusqlite_migrated().await;

    let mut full = five_subjects();
    full[5] = ("biology", Some(80.0));
    let created = create_exam_session_impl(&conn, payload("月考", "2026-11-20", &full))
        .expect("create");

    let exported = export_json_impl(&conn).expect("export");
    let payload_json: serde_json::Value =
        serde_json::from_str(&exported).expect("payload json");
    assert!(payload_json.get("exam_sessions").is_some());
    assert!(payload_json.get("exam_scores").is_some());

    delete_exam_session_impl(&conn, created.id).unwrap();
    import_json_impl(&conn, &exported).expect("import");

    let restored = list_exam_sessions_impl(&conn).expect("list");
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].name, "月考");
    assert_eq!(restored[0].date, "2026-11-20");
    assert_eq!(restored[0].id, created.id);
    assert_eq!(score_of(&conn, created.id, "biology"), Some(80.0));
    assert_eq!(score_of(&conn, created.id, "chinese"), Some(110.0));

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn import_v1_payload_with_flat_exam_records_expands_into_score_rows() {
    let (path, conn) = open_rusqlite_migrated().await;

    let legacy = r#"{
      "version": 1,
      "exam_records": [
        {
          "id": 7,
          "exam_name": "一模",
          "exam_date": "2026-10-08",
          "chinese_score": 100,
          "math_score": 120,
          "english_score": 110,
          "physics_score": 60,
          "chemistry_score": null,
          "biology_score": null,
          "created_at": "2026-10-08 12:00:00",
          "is_mock": 0
        }
      ]
    }"#;
    import_json_impl(&conn, legacy).expect("import legacy payload");

    let restored = list_exam_sessions_impl(&conn).expect("list");
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].id, 7);
    assert_eq!(restored[0].name, "一模");
    assert_eq!(restored[0].date, "2026-10-08");
    assert_eq!(score_of(&conn, 7, "chinese"), Some(100.0));
    assert_eq!(score_of(&conn, 7, "math"), Some(120.0));
    assert_eq!(score_of(&conn, 7, "chemistry"), None);
    assert_eq!(score_of(&conn, 7, "biology"), None);

    let _ = std::fs::remove_file(&path);
}
