//! `user_profile` singleton: migration seed, empty-table insert, update, export.

use rusqlite::Connection;
use serde_json::Value;
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use timequest_lib::{
    export_json_impl, get_user_profile_impl, import_json_impl, update_user_profile_impl,
    SubjectTargets, UserProfile,
};

async fn open_rusqlite_migrated() -> (PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("timequest-profile-{}.db", uuid::Uuid::new_v4()));
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

fn profile_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM user_profile", [], |row| row.get(0))
        .expect("count user_profile")
}

#[tokio::test]
async fn get_user_profile_reads_migration_default_and_reinserts_when_empty() {
    let (path, conn) = open_rusqlite_migrated().await;

    assert_eq!(profile_count(&conn), 1, "migration inserts the singleton");
    let seeded = get_user_profile_impl(&conn).expect("read seed");
    assert_eq!(seeded, UserProfile::default());
    assert_eq!(
        seeded.total_target,
        seeded.subject_targets.sum(),
        "default total matches the six subjects"
    );
    assert_eq!(seeded.subject_targets, SubjectTargets::default());
    assert!(seeded.avatar.is_none());

    conn.execute("DELETE FROM user_profile", [])
        .expect("clear profile");
    assert_eq!(profile_count(&conn), 0);

    let restored = get_user_profile_impl(&conn).expect("insert default when empty");
    assert_eq!(restored, UserProfile::default());
    assert_eq!(profile_count(&conn), 1, "empty table gains exactly one row");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn update_user_profile_overwrites_single_row_and_rejects_negative() {
    let (path, conn) = open_rusqlite_migrated().await;

    let mut next = UserProfile::default();
    next.grade = " 高三 ".to_string();
    next.region = " 湖南省 ".to_string();
    next.total_target = 600;
    next.subject_targets.math = 140;
    next.avatar = Some("data:image/png;base64,abc".to_string());

    let saved = update_user_profile_impl(&conn, next.clone()).expect("update");
    assert_eq!(saved.grade, "高三");
    assert_eq!(saved.region, "湖南省");
    assert_eq!(saved.total_target, 600);
    assert_eq!(saved.subject_targets.math, 140);
    assert_eq!(saved.avatar.as_deref(), Some("data:image/png;base64,abc"));
    assert_eq!(profile_count(&conn), 1, "update stays one row");

    let again = get_user_profile_impl(&conn).expect("read back");
    assert_eq!(again, saved);

    let mut bad = saved.clone();
    bad.total_target = -1;
    let err = update_user_profile_impl(&conn, bad).expect_err("negative total");
    assert!(err.contains("不能为负数"), "got {err}");
    assert_eq!(
        get_user_profile_impl(&conn)
            .expect("unchanged")
            .total_target,
        600
    );

    let mut subject_bad = saved.clone();
    subject_bad.subject_targets.physics = -5;
    let err = update_user_profile_impl(&conn, subject_bad).expect_err("negative subject");
    assert!(err.contains("物理"), "got {err}");
    assert_eq!(
        get_user_profile_impl(&conn)
            .expect("unchanged subject")
            .subject_targets
            .physics,
        SubjectTargets::default().physics
    );

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn user_profile_survives_export_import_and_old_backup_resets_default() {
    let (path, conn) = open_rusqlite_migrated().await;

    let mut custom = UserProfile::default();
    custom.region = "湖南省".to_string();
    custom.total_target = 600;
    custom.subject_targets.chinese = 110;
    custom.avatar = Some("data:image/png;base64,qq".to_string());
    update_user_profile_impl(&conn, custom.clone()).expect("seed custom");

    let exported = export_json_impl(&conn).expect("export");
    let parsed: Value = serde_json::from_str(&exported).expect("parse");
    assert_eq!(parsed["user_profile"]["region"], "湖南省");
    assert_eq!(parsed["user_profile"]["total_target"], 600);
    assert_eq!(parsed["user_profile"]["subject_targets"]["chinese"], 110);
    assert_eq!(parsed["user_profile"]["avatar"], "data:image/png;base64,qq");
    assert!(parsed["user_profile"].get("id").is_none());

    let mut other = UserProfile::default();
    other.region = "北京市".to_string();
    update_user_profile_impl(&conn, other).expect("overwrite before import");
    import_json_impl(&conn, &exported).expect("round trip");
    let restored = get_user_profile_impl(&conn).expect("after import");
    assert_eq!(restored.region, "湖南省");
    assert_eq!(restored.total_target, 600);
    assert_eq!(restored.subject_targets.chinese, 110);
    assert_eq!(restored.avatar.as_deref(), Some("data:image/png;base64,qq"));

    let mut without_profile = parsed.clone();
    without_profile
        .as_object_mut()
        .expect("object")
        .remove("user_profile");
    import_json_impl(&conn, &without_profile.to_string()).expect("old backup");
    assert_eq!(
        get_user_profile_impl(&conn).expect("reset"),
        UserProfile::default(),
        "backup without user_profile restores the seeded singleton"
    );

    let mut wrong_id = parsed;
    wrong_id["user_profile"]["id"] = Value::from(2);
    let err = import_json_impl(&conn, &wrong_id.to_string()).expect_err("id must be 1");
    assert!(err.contains("user_profile"), "got {err}");
    assert_eq!(
        get_user_profile_impl(&conn).expect("rolled back").grade,
        UserProfile::default().grade
    );

    let _ = std::fs::remove_file(&path);
}
