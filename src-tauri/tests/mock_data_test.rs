//! Demo rows carry `is_mock = 1`. Clearing them leaves `is_mock = 0` rows in place.

use rusqlite::{params, Connection};
use serde_json::Value;
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use timequest_lib::{
    clear_mock_data_impl, export_json_impl, generate_mock_data_impl, has_mock_data_impl,
    import_json_impl,
};

async fn open_rusqlite_migrated() -> (PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("timequest-mock-{}.db", uuid::Uuid::new_v4()));
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

fn count_where(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |row| row.get(0)).expect(sql)
}

fn stats(conn: &Connection) -> (i64, i64, i64, i64, Option<String>) {
    conn.query_row(
        "SELECT total_xp, current_level, current_streak, longest_streak, last_done_date FROM user_stats WHERE id = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    )
    .expect("user_stats")
}

fn seed_real_rows(conn: &Connection) -> (i64, i64) {
    conn.execute(
        r#"INSERT INTO tasks (title, type, subject, unit_name, total_units, total_rounds, current_round, is_mock)
           VALUES ('真实数学', 'main', '数学', '课', 10, 1, 1, 0)"#,
        [],
    )
    .unwrap();
    let task_id = conn.last_insert_rowid();
    conn.execute(
        r#"INSERT INTO task_sessions (
             task_id, date, start_time, end_time, round, status, planned_units, actual_units, is_mock
           ) VALUES (?1, '2026-10-01', '09:00', '10:00', 1, 'planned', 2, 0, 0)"#,
        params![task_id],
    )
    .unwrap();
    let session_id = conn.last_insert_rowid();
    conn.execute(
        r#"INSERT INTO exam_records (exam_name, exam_date, math_score, is_mock)
           VALUES ('真实月考', '2026-10-01', 100, 0)"#,
        [],
    )
    .unwrap();
    conn.execute(
        r#"INSERT INTO actual_logs (date, duration_min, tag_type, session_id, note)
           VALUES ('2026-10-01', 30, 'study', NULL, '手记') "#,
        [],
    )
    .unwrap();
    (task_id, session_id)
}

#[tokio::test]
async fn generate_mock_data_marks_every_inserted_row() {
    let (path, conn) = open_rusqlite_migrated().await;
    let today = chrono::Local::now()
        .date_naive()
        .format("%Y-%m-%d")
        .to_string();

    generate_mock_data_impl(&conn).expect("generate");

    assert!(has_mock_data_impl(&conn).unwrap());
    assert_eq!(count_where(&conn, "SELECT COUNT(*) FROM tasks"), 3);
    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM tasks WHERE is_mock = 1"),
        3
    );
    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM tasks WHERE is_mock = 0"),
        0
    );
    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM tasks WHERE type = 'main'"),
        3
    );
    let mut titles = Vec::new();
    let mut stmt = conn.prepare("SELECT title FROM tasks ORDER BY id").unwrap();
    let rows = stmt.query_map([], |row| row.get::<_, String>(0)).unwrap();
    for title in rows {
        titles.push(title.unwrap());
    }
    assert_eq!(titles, vec!["数学必修一", "物理必修一", "英语必修一"]);

    assert_eq!(count_where(&conn, "SELECT COUNT(*) FROM task_sessions"), 4);
    assert_eq!(
        count_where(
            &conn,
            "SELECT COUNT(*) FROM task_sessions WHERE is_mock = 1"
        ),
        4
    );
    assert_eq!(
        count_where(
            &conn,
            "SELECT COUNT(*) FROM task_sessions WHERE status = 'done' AND is_mock = 1"
        ),
        2
    );
    assert_eq!(
        count_where(
            &conn,
            "SELECT COUNT(*) FROM task_sessions WHERE status = 'planned' AND is_mock = 1"
        ),
        2
    );
    assert_eq!(
        count_where(
            &conn,
            &format!("SELECT COUNT(*) FROM task_sessions WHERE date = '{today}'")
        ),
        4
    );

    assert_eq!(count_where(&conn, "SELECT COUNT(*) FROM exam_records"), 2);
    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM exam_records WHERE is_mock = 1"),
        2
    );
    assert_eq!(
        count_where(
            &conn,
            &format!("SELECT COUNT(*) FROM exam_records WHERE exam_date < '{today}'")
        ),
        2
    );
    assert_eq!(count_where(&conn, "SELECT COUNT(*) FROM actual_logs"), 0);

    let (xp, level, streak, longest, last) = stats(&conn);
    assert!(xp > 0, "demo xp should be visible");
    assert!(level >= 1);
    assert!(streak > 0, "demo streak should be visible");
    assert!(longest >= streak);
    assert_eq!(last.as_deref(), Some(today.as_str()));

    let xp_before = xp;
    generate_mock_data_impl(&conn).expect("second generate is a no-op");
    assert_eq!(count_where(&conn, "SELECT COUNT(*) FROM tasks"), 3);
    assert_eq!(stats(&conn).0, xp_before);

    let exported: Value = serde_json::from_str(&export_json_impl(&conn).unwrap()).unwrap();
    for key in ["tasks", "task_sessions", "exam_records"] {
        let rows = exported[key].as_array().unwrap();
        assert!(!rows.is_empty());
        for row in rows {
            assert_eq!(row["is_mock"], 1, "{key} export must keep is_mock");
        }
    }

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn clear_mock_data_removes_only_mock_rows() {
    let (path, conn) = open_rusqlite_migrated().await;
    conn.execute(
        "UPDATE user_stats SET total_xp = 80, current_level = 1, current_streak = 2, longest_streak = 9, last_done_date = '2026-10-01' WHERE id = 1",
        [],
    )
    .unwrap();
    let (real_task, real_session) = seed_real_rows(&conn);

    clear_mock_data_impl(&conn).expect("clear with nothing mock");
    assert_eq!(stats(&conn).0, 80, "no mock rows means stats stay");
    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM tasks WHERE is_mock = 0"),
        1
    );

    generate_mock_data_impl(&conn).expect("generate beside real rows");
    assert_eq!(stats(&conn).0, 80, "existing xp is not replaced by demo xp");
    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM tasks WHERE is_mock = 1"),
        3
    );
    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM tasks WHERE is_mock = 0"),
        1
    );

    let mock_session: i64 = conn
        .query_row(
            "SELECT id FROM task_sessions WHERE is_mock = 1 LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    conn.execute(
        r#"INSERT INTO actual_logs (date, duration_min, tag_type, session_id, note)
           VALUES ('2026-11-06', 40, 'study', ?1, '演示完成带出的流水')"#,
        params![mock_session],
    )
    .unwrap();

    clear_mock_data_impl(&conn).expect("clear");

    assert!(!has_mock_data_impl(&conn).unwrap());
    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM tasks WHERE is_mock = 1"),
        0
    );
    assert_eq!(
        count_where(
            &conn,
            "SELECT COUNT(*) FROM task_sessions WHERE is_mock = 1"
        ),
        0
    );
    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM exam_records WHERE is_mock = 1"),
        0
    );

    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM tasks WHERE is_mock = 0"),
        1
    );
    assert_eq!(
        count_where(
            &conn,
            "SELECT COUNT(*) FROM task_sessions WHERE is_mock = 0"
        ),
        1
    );
    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM exam_records WHERE is_mock = 0"),
        1
    );
    let title: String = conn
        .query_row(
            "SELECT title FROM tasks WHERE id = ?1",
            params![real_task],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(title, "真实数学");
    let status: String = conn
        .query_row(
            "SELECT status FROM task_sessions WHERE id = ?1",
            params![real_session],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(status, "planned");
    let math: i64 = conn
        .query_row(
            "SELECT math_score FROM exam_records WHERE exam_name = '真实月考'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(math, 100);
    assert_eq!(
        count_where(
            &conn,
            "SELECT COUNT(*) FROM actual_logs WHERE note = '手记'"
        ),
        1
    );
    assert_eq!(
        count_where(
            &conn,
            "SELECT COUNT(*) FROM actual_logs WHERE session_id IS NOT NULL"
        ),
        0,
        "logs hanging off mock sessions go away with those sessions"
    );
    let (xp, _, streak, longest, last) = stats(&conn);
    assert_eq!(xp, 80);
    assert_eq!(streak, 2);
    assert_eq!(longest, 9);
    assert_eq!(last.as_deref(), Some("2026-10-01"));

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn clear_mock_data_resets_stats_when_no_real_rows() {
    let (path, conn) = open_rusqlite_migrated().await;
    generate_mock_data_impl(&conn).expect("generate");
    assert!(stats(&conn).0 > 0);

    clear_mock_data_impl(&conn).expect("clear");

    assert_eq!(count_where(&conn, "SELECT COUNT(*) FROM tasks"), 0);
    assert_eq!(count_where(&conn, "SELECT COUNT(*) FROM task_sessions"), 0);
    assert_eq!(count_where(&conn, "SELECT COUNT(*) FROM exam_records"), 0);
    assert_eq!(count_where(&conn, "SELECT COUNT(*) FROM actual_logs"), 0);
    let (xp, level, streak, longest, last) = stats(&conn);
    assert_eq!(xp, 0);
    assert_eq!(level, 1);
    assert_eq!(streak, 0);
    assert_eq!(longest, 0);
    assert!(last.is_none());

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn import_missing_is_mock_defaults_to_zero() {
    let (path, conn) = open_rusqlite_migrated().await;
    generate_mock_data_impl(&conn).expect("generate");
    let exported = export_json_impl(&conn).unwrap();
    let mut payload: Value = serde_json::from_str(&exported).unwrap();
    for key in ["tasks", "task_sessions", "exam_records"] {
        for row in payload[key].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("is_mock");
        }
    }
    let stripped = serde_json::to_string(&payload).unwrap();
    import_json_impl(&conn, &stripped).expect("import old backup");

    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM tasks WHERE is_mock = 0"),
        3
    );
    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM tasks WHERE is_mock = 1"),
        0
    );
    assert_eq!(
        count_where(
            &conn,
            "SELECT COUNT(*) FROM task_sessions WHERE is_mock = 0"
        ),
        4
    );
    assert_eq!(
        count_where(&conn, "SELECT COUNT(*) FROM exam_records WHERE is_mock = 0"),
        2
    );
    assert!(!has_mock_data_impl(&conn).unwrap());

    let _ = std::fs::remove_file(&path);
}
