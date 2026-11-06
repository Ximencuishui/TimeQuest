//! `app_settings` key-value: read-after-write, and repeat set stays one row.

use rusqlite::{params, Connection};
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use timequest_lib::{get_setting_impl, set_setting_impl};

async fn open_rusqlite_migrated() -> (PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!(
        "timequest-app-settings-{}.db",
        uuid::Uuid::new_v4()
    ));
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

fn count_key(conn: &Connection, key: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .expect("count key")
}

#[tokio::test]
async fn set_setting_then_get_is_idempotent() {
    let (path, conn) = open_rusqlite_migrated().await;

    let missing = get_setting_impl(&conn, "motivation").expect("get missing");
    assert_eq!(missing, None);

    set_setting_impl(&conn, "motivation", "多考一分，干掉千人").expect("first set");
    assert_eq!(
        get_setting_impl(&conn, "motivation")
            .expect("get after set")
            .as_deref(),
        Some("多考一分，干掉千人")
    );
    assert_eq!(count_key(&conn, "motivation"), 1);

    set_setting_impl(&conn, "motivation", "多考一分，干掉千人").expect("same value again");
    assert_eq!(
        count_key(&conn, "motivation"),
        1,
        "repeat set must not insert a second row"
    );
    assert_eq!(
        get_setting_impl(&conn, "motivation")
            .expect("get after repeat")
            .as_deref(),
        Some("多考一分，干掉千人")
    );

    set_setting_impl(&conn, "motivation", "先做完，再怀疑人生").expect("overwrite");
    assert_eq!(count_key(&conn, "motivation"), 1, "overwrite stays one row");
    assert_eq!(
        get_setting_impl(&conn, "motivation")
            .expect("get after overwrite")
            .as_deref(),
        Some("先做完，再怀疑人生")
    );

    let updated_at: String = conn
        .query_row(
            "SELECT updated_at FROM app_settings WHERE key = ?1",
            params!["motivation"],
            |row| row.get(0),
        )
        .expect("updated_at");
    assert!(!updated_at.is_empty());

    set_setting_impl(&conn, "theme", "orange").expect("second key");
    assert_eq!(count_key(&conn, "motivation"), 1);
    assert_eq!(count_key(&conn, "theme"), 1);
    assert_eq!(
        get_setting_impl(&conn, "theme")
            .expect("get theme")
            .as_deref(),
        Some("orange")
    );

    let _ = std::fs::remove_file(&path);
}
