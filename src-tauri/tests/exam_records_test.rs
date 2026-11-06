//! Exam sittings: create, list order, null subject, delete, export round trip.

use rusqlite::Connection;
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use timequest_lib::{
    create_exam_record_impl, delete_exam_record_impl, export_json_impl, import_json_impl,
    list_exam_records_impl, CreateExamRecordPayload,
};

async fn open_rusqlite_migrated() -> (PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("timequest-exams-{}.db", uuid::Uuid::new_v4()));
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

fn sample(name: &str, date: &str, biology: Option<i64>) -> CreateExamRecordPayload {
    CreateExamRecordPayload {
        exam_name: name.to_string(),
        exam_date: date.to_string(),
        chinese_score: Some(110),
        math_score: Some(130),
        english_score: Some(115),
        physics_score: Some(70),
        chemistry_score: Some(75),
        biology_score: biology,
    }
}

#[tokio::test]
async fn create_exam_record_stores_null_subject_and_lists_newest_first() {
    let (path, conn) = open_rusqlite_migrated().await;

    let err =
        create_exam_record_impl(&conn, sample("   ", "2026-11-06", None)).expect_err("blank name");
    assert!(err.contains("考试名称"), "got {err}");
    assert!(list_exam_records_impl(&conn).unwrap().is_empty());

    let mut negative = sample("期中", "2026-11-06", None);
    negative.math_score = Some(-1);
    let err = create_exam_record_impl(&conn, negative).expect_err("negative score");
    assert!(err.contains("数学"), "got {err}");
    assert!(list_exam_records_impl(&conn).unwrap().is_empty());

    let mut blank = sample("空卷", "2026-11-06", None);
    blank.chinese_score = None;
    blank.math_score = None;
    blank.english_score = None;
    blank.physics_score = None;
    blank.chemistry_score = None;
    blank.biology_score = None;
    let err = create_exam_record_impl(&conn, blank).expect_err("every subject empty");
    assert!(err.contains("至少填写一科"), "got {err}");
    assert!(list_exam_records_impl(&conn).unwrap().is_empty());

    let first = create_exam_record_impl(&conn, sample("  2026届高三上期中考  ", "2026-11-1", None))
        .expect("create partial");
    assert_eq!(first.exam_name, "2026届高三上期中考");
    assert_eq!(first.exam_date, "2026-11-01");
    assert_eq!(first.chinese_score, Some(110));
    assert_eq!(first.math_score, Some(130));
    assert_eq!(first.english_score, Some(115));
    assert_eq!(first.physics_score, Some(70));
    assert_eq!(first.chemistry_score, Some(75));
    assert_eq!(first.biology_score, None);

    let second =
        create_exam_record_impl(&conn, sample("月考", "2026-11-20", Some(80))).expect("later exam");
    let listed = list_exam_records_impl(&conn).expect("list");
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, second.id, "later date comes first");
    assert_eq!(listed[1].id, first.id);
    assert_eq!(listed[0].biology_score, Some(80));

    delete_exam_record_impl(&conn, first.id).expect("delete");
    let after = list_exam_records_impl(&conn).unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].id, second.id);
    let missing = delete_exam_record_impl(&conn, first.id).expect_err("already gone");
    assert!(missing.contains("不存在"), "got {missing}");

    let exported = export_json_impl(&conn).expect("export");
    delete_exam_record_impl(&conn, second.id).unwrap();
    import_json_impl(&conn, &exported).expect("import");
    let restored = list_exam_records_impl(&conn).unwrap();
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].exam_name, "月考");
    assert_eq!(restored[0].exam_date, "2026-11-20");
    assert_eq!(restored[0].biology_score, Some(80));
    assert_eq!(restored[0].id, second.id);

    let _ = std::fs::remove_file(&path);
}
