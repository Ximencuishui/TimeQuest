use rusqlite::Connection;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::path::PathBuf;
use timequest_lib::{update_task_impl, UpdateTaskPayload};

/// In-memory DB with migrations applied, plus a rusqlite handle on the same file
/// (the task commands run on the rusqlite connection, not the sqlx pool).
async fn open_shared() -> (PathBuf, SqlitePool, Connection) {
    let path = std::env::temp_dir().join(format!("timequest-task-update-{}.db", uuid::Uuid::new_v4()));
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    let path_str = path.to_string_lossy().replace('\\', "/");
    let url = format!("sqlite:{path_str}?mode=rwc");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let conn = Connection::open(&path).expect("rusqlite");
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    (path, pool, conn)
}

async fn insert_main(pool: &SqlitePool, textbook: Option<&str>) -> i64 {
    sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, textbook, unit_name, total_units, total_rounds, current_round)
           VALUES ('数学必修一', 'main', '数学', ?1, '课', 20, 2, 1)"#,
    )
    .bind(textbook)
    .execute(pool)
    .await
    .expect("insert task")
    .last_insert_rowid()
}

fn payload(
    title: Option<&str>,
    subject: Option<&str>,
    textbook: Option<&str>,
) -> UpdateTaskPayload {
    UpdateTaskPayload {
        title: title.map(|v| v.to_string()),
        subject: subject.map(|v| v.to_string()),
        textbook: textbook.map(|v| v.to_string()),
        unit_name: None,
        total_units: None,
        total_rounds: None,
        color: None,
    }
}

#[tokio::test]
async fn update_task_changes_only_the_given_fields() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_main(&pool, Some("人教A版")).await;

    let updated = update_task_impl(
        &conn,
        task_id,
        payload(Some("数学必修一 第一轮"), None, None),
    )
    .expect("update task");

    assert_eq!(updated.title, "数学必修一 第一轮");
    // 没传的字段保持原值。
    assert_eq!(updated.subject.as_deref(), Some("数学"));
    assert_eq!(updated.textbook.as_deref(), Some("人教A版"));
    assert_eq!(updated.total_units, Some(20));
    assert_eq!(updated.total_rounds, 2);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn update_task_can_switch_subject() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_main(&pool, Some("人教A版")).await;

    let updated = update_task_impl(&conn, task_id, payload(None, Some("物理"), None))
        .expect("update subject");

    assert_eq!(updated.subject.as_deref(), Some("物理"));
    // 课本没动，还留着。
    assert_eq!(updated.textbook.as_deref(), Some("人教A版"));

    let stored: Option<String> =
        sqlx::query_scalar("SELECT subject FROM tasks WHERE id = ?1")
            .bind(task_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored.as_deref(), Some("物理"));

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn update_task_empty_textbook_clears_the_column() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_main(&pool, Some("人教A版")).await;

    let updated = update_task_impl(&conn, task_id, payload(None, None, Some("")))
        .expect("clear textbook");

    assert_eq!(updated.textbook, None);

    // 库里存的是 NULL，不是空串。
    let stored: Option<String> =
        sqlx::query_scalar("SELECT textbook FROM tasks WHERE id = ?1")
            .bind(task_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored, None);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn update_task_trims_textbook_whitespace() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_main(&pool, None).await;

    let updated = update_task_impl(&conn, task_id, payload(None, None, Some("  人教A版  ")))
        .expect("trim textbook");

    assert_eq!(updated.textbook.as_deref(), Some("人教A版"));

    let _ = std::fs::remove_file(&path);
}
