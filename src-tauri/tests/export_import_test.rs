//! Export / import round-trip and failure semantics.
//!
//! A 段确认：导入在单事务内；`rescheduled_to` 原实现随行直插且 FK=ON，
//! 自引用在「源 id < 目标 id」时会炸。导入侧已改为先插 NULL 再 UPDATE。

use chrono::Local;
use rusqlite::{params, Connection};
use serde_json::Value;
use sqlx::sqlite::SqlitePoolOptions;
use std::collections::BTreeSet;
use std::path::PathBuf;
use timequest_lib::{
    complete_session_impl, export_json_impl, import_json_impl, stats_tag_type_totals_impl,
    task_progress_impl,
};

/// Payload 顶层元数据 key（A 段）：不是表名，比较时剔除。
const EXPORT_META_KEYS: &[&str] = &["version", "exported_at"];

/// 有意不进备份 JSON 的目录/种子表（迁移重种子即可）。
/// 新增**用户数据**表时禁止往这里塞——应改导出；否则本护栏失效。
const INTENTIONAL_EXPORT_OMISSIONS: &[&str] = &["achievements"];

fn list_user_tables(conn: &Connection) -> BTreeSet<String> {
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master WHERE type='table'
             AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_sqlx_%'",
        )
        .expect("prepare sqlite_master");
    stmt.query_map([], |r| r.get::<_, String>(0))
        .expect("query sqlite_master")
        .collect::<Result<BTreeSet<_>, _>>()
        .expect("collect table names")
}

fn exported_table_keys(payload: &Value) -> BTreeSet<String> {
    let obj = payload
        .as_object()
        .expect("export payload must be a JSON object");
    obj.keys()
        .filter(|k| !EXPORT_META_KEYS.contains(&k.as_str()))
        .cloned()
        .collect()
}

/// Bidirectional coverage check. Ok(()) when sets match; Err(message) with diffs.
fn export_table_coverage_error(
    actual_tables: &BTreeSet<String>,
    exported_tables: &BTreeSet<String>,
) -> Result<(), String> {
    let omitted: BTreeSet<String> = INTENTIONAL_EXPORT_OMISSIONS
        .iter()
        .map(|s| (*s).to_string())
        .collect();
    let expected = actual_tables
        .difference(&omitted)
        .cloned()
        .collect::<BTreeSet<_>>();

    let in_db_not_exported: BTreeSet<_> = expected.difference(exported_tables).cloned().collect();
    let in_export_not_db: BTreeSet<_> = exported_tables.difference(&expected).cloned().collect();

    if in_db_not_exported.is_empty() && in_export_not_db.is_empty() {
        return Ok(());
    }
    Err(format!(
        "export table coverage mismatch:\n  in DB but not exported: {in_db_not_exported:?}\n  in export but not in DB: {in_export_not_db:?}\n  actual_tables={actual_tables:?}\n  exported_tables={exported_tables:?}\n  intentional_omissions={omitted:?}"
    ))
}

struct Counts {
    tasks: i64,
    sessions: i64,
    logs: i64,
    notes: i64,
    achievements: i64,
}

fn count_all(conn: &Connection) -> Counts {
    let one = |sql: &str| -> i64 {
        conn.query_row(sql, [], |r| r.get(0))
            .unwrap_or_else(|e| panic!("count `{sql}`: {e}"))
    };
    Counts {
        tasks: one("SELECT COUNT(*) FROM tasks"),
        sessions: one("SELECT COUNT(*) FROM task_sessions"),
        logs: one("SELECT COUNT(*) FROM actual_logs"),
        notes: one("SELECT COUNT(*) FROM notes"),
        achievements: one("SELECT COUNT(*) FROM user_achievements"),
    }
}

async fn open_rusqlite_migrated() -> (PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!(
        "timequest-export-import-{}.db",
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

/// Seed covering every exported table / status / nullability corner.
fn seed_full_dataset(conn: &Connection) -> (i64, i64) {
    // main: textbook NULL, total_units=10, current_round=2
    conn.execute(
        r#"INSERT INTO tasks (id, title, type, subject, textbook, unit_name, total_units, total_rounds, current_round, color, archived, created_at)
           VALUES (1, '主线数学', 'main', '数学', NULL, '课', 10, 3, 2, '#F97316', 0, '2026-01-01 10:00:00')"#,
        [],
    )
    .unwrap();
    // side: textbook non-null
    conn.execute(
        r#"INSERT INTO tasks (id, title, type, subject, textbook, unit_name, total_units, total_rounds, current_round, color, archived, created_at)
           VALUES (2, '副本英语', 'side', '英语', '必修一', '课', NULL, 1, 1, '#14B8A6', 0, '2026-01-02 10:00:00')"#,
        [],
    )
    .unwrap();
    // archived
    conn.execute(
        r#"INSERT INTO tasks (id, title, type, subject, textbook, unit_name, total_units, total_rounds, current_round, color, archived, created_at)
           VALUES (3, '已归档物理', 'side', '物理', NULL, '课', NULL, 1, 1, NULL, 1, '2026-01-03 10:00:00')"#,
        [],
    )
    .unwrap();

    // Session A (rescheduled) → B (planned). Insert B first so A can point at it under FK=ON while seeding.
    conn.execute(
        r#"INSERT INTO task_sessions (id, task_id, date, start_time, end_time, round, status, planned_units, actual_units, self_rating, self_note, rescheduled_to, xp_awarded, created_at)
           VALUES (20, 1, '2026-11-05', '10:00', '11:00', 2, 'planned', 3, 0, NULL, NULL, NULL, 0, '2026-11-04 12:00:00')"#,
        [],
    )
    .unwrap();
    let session_b = 20i64;
    conn.execute(
        r#"INSERT INTO task_sessions (id, task_id, date, start_time, end_time, round, status, planned_units, actual_units, self_rating, self_note, rescheduled_to, xp_awarded, created_at)
           VALUES (10, 1, '2026-11-04', '09:00', '10:00', 2, 'rescheduled', 3, 0, NULL, NULL, ?1, 0, '2026-11-04 09:00:00')"#,
        params![session_b],
    )
    .unwrap();
    let session_a = 10i64;

    // done (self_note non-null)
    conn.execute(
        r#"INSERT INTO task_sessions (id, task_id, date, start_time, end_time, round, status, planned_units, actual_units, self_rating, self_note, rescheduled_to, xp_awarded, created_at)
           VALUES (11, 1, '2026-11-03', '09:00', '10:00', 1, 'done', 5, 5, 4, '状态不错', NULL, 50, '2026-11-03 10:00:00')"#,
        [],
    )
    .unwrap();
    // missed (self_note NULL)
    conn.execute(
        r#"INSERT INTO task_sessions (id, task_id, date, start_time, end_time, round, status, planned_units, actual_units, self_rating, self_note, rescheduled_to, xp_awarded, created_at)
           VALUES (12, 2, '2026-11-02', '14:00', '15:00', 1, 'missed', 2, 0, NULL, NULL, NULL, 0, '2026-11-02 15:00:00')"#,
        [],
    )
    .unwrap();
    // planned (extra)
    conn.execute(
        r#"INSERT INTO task_sessions (id, task_id, date, start_time, end_time, round, status, planned_units, actual_units, self_rating, self_note, rescheduled_to, xp_awarded, created_at)
           VALUES (13, 2, '2026-11-06', '16:00', '17:00', 1, 'planned', 1, 0, NULL, NULL, NULL, 0, '2026-11-06 08:00:00')"#,
        [],
    )
    .unwrap();

    // logs: study linked to session; sport / game without session
    conn.execute(
        r#"INSERT INTO actual_logs (id, date, start_at, end_at, duration_min, subject, method, tag_type, session_id, note, created_at)
           VALUES (100, '2026-11-03', '2026-11-03T09:00:00', '2026-11-03T10:00:00', 60, '数学', '刷题', 'study', 11, '完成流水', '2026-11-03 10:01:00')"#,
        [],
    )
    .unwrap();
    conn.execute(
        r#"INSERT INTO actual_logs (id, date, start_at, end_at, duration_min, subject, method, tag_type, session_id, note, created_at)
           VALUES (101, '2026-11-03', NULL, NULL, 30, NULL, NULL, 'sport', NULL, NULL, '2026-11-03 18:00:00')"#,
        [],
    )
    .unwrap();
    conn.execute(
        r#"INSERT INTO actual_logs (id, date, start_at, end_at, duration_min, subject, method, tag_type, session_id, note, created_at)
           VALUES (102, '2026-11-03', NULL, NULL, 45, NULL, NULL, 'game', NULL, '摸鱼', '2026-11-03 20:00:00')"#,
        [],
    )
    .unwrap();

    conn.execute(
        r#"INSERT INTO notes (id, content, color, pinned, created_at, updated_at)
           VALUES (1, '置顶笔记', 'yellow', 1, '2026-01-10 08:00:00', '2026-01-11 08:00:00')"#,
        [],
    )
    .unwrap();
    conn.execute(
        r#"INSERT INTO notes (id, content, color, pinned, created_at, updated_at)
           VALUES (2, '普通笔记', 'blue', 0, '2026-01-12 08:00:00', '2026-01-12 08:00:00')"#,
        [],
    )
    .unwrap();

    conn.execute(
        r#"UPDATE user_stats SET total_xp=350, current_level=3, current_streak=4,
            longest_streak=7, last_done_date='2026-11-03' WHERE id=1"#,
        [],
    )
    .unwrap();

    conn.execute(
        "INSERT INTO user_achievements (achievement_id, unlocked_at) VALUES ('first_round', '2026-11-01 12:00:00')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO user_achievements (achievement_id, unlocked_at) VALUES ('comeback', '2026-11-02 12:00:00')",
        [],
    )
    .unwrap();

    (session_a, session_b)
}

fn assert_fk_ok(conn: &Connection) {
    let mut stmt = conn
        .prepare("PRAGMA foreign_key_check")
        .expect("prepare fk check");
    let rows: Vec<(String, i64, String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(
        rows.is_empty(),
        "PRAGMA foreign_key_check reported violations: {rows:?}"
    );
    let fk_on: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fk_on, 1, "foreign_keys must remain ON after import");
}

#[tokio::test]
async fn export_import_round_trip_preserves_rows() {
    let (path, conn) = open_rusqlite_migrated().await;
    let (session_a, session_b) = seed_full_dataset(&conn);

    let before = count_all(&conn);
    assert_eq!(before.tasks, 3);
    assert_eq!(before.sessions, 5);
    assert_eq!(before.logs, 3);
    assert_eq!(before.notes, 2);
    assert_eq!(before.achievements, 2);

    // Snapshot key fields before export/import.
    let main_textbook: Option<String> = conn
        .query_row("SELECT textbook FROM tasks WHERE id=1", [], |r| r.get(0))
        .unwrap();
    assert!(main_textbook.is_none());
    let side_textbook: Option<String> = conn
        .query_row("SELECT textbook FROM tasks WHERE id=2", [], |r| r.get(0))
        .unwrap();
    assert_eq!(side_textbook.as_deref(), Some("必修一"));
    let archived: i64 = conn
        .query_row("SELECT archived FROM tasks WHERE id=3", [], |r| r.get(0))
        .unwrap();
    assert_eq!(archived, 1);
    let done_note: Option<String> = conn
        .query_row("SELECT self_note FROM task_sessions WHERE id=11", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(done_note.as_deref(), Some("状态不错"));
    let missed_note: Option<String> = conn
        .query_row("SELECT self_note FROM task_sessions WHERE id=12", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(missed_note.is_none());
    let note_pinned: i64 = conn
        .query_row("SELECT pinned FROM notes WHERE id=1", [], |r| r.get(0))
        .unwrap();
    let note_unpinned: i64 = conn
        .query_row("SELECT pinned FROM notes WHERE id=2", [], |r| r.get(0))
        .unwrap();
    assert_eq!(note_pinned, 1);
    assert_eq!(note_unpinned, 0);
    let created_main: String = conn
        .query_row("SELECT created_at FROM tasks WHERE id=1", [], |r| r.get(0))
        .unwrap();
    let note_updated: String = conn
        .query_row("SELECT updated_at FROM notes WHERE id=1", [], |r| r.get(0))
        .unwrap();
    let last_done: Option<String> = conn
        .query_row(
            "SELECT last_done_date FROM user_stats WHERE id=1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(last_done.as_deref(), Some("2026-11-03"));

    let payload = export_json_impl(&conn).expect("export");
    let parsed: Value = serde_json::from_str(&payload).expect("parse export json");

    // archived / pinned must be JSON numbers (0/1), not strings / booleans.
    let archived_json = parsed["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == 3)
        .unwrap()["archived"]
        .clone();
    assert!(
        archived_json.is_i64() || archived_json.is_u64(),
        "archived must be integer in export, got {archived_json}"
    );
    assert_eq!(
        archived_json
            .as_i64()
            .or_else(|| archived_json.as_u64().map(|u| u as i64)),
        Some(1)
    );
    let pinned_json = parsed["notes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == 1)
        .unwrap()["pinned"]
        .clone();
    assert!(pinned_json.is_i64() || pinned_json.is_u64());
    assert_eq!(
        pinned_json
            .as_i64()
            .or_else(|| pinned_json.as_u64().map(|u| u as i64)),
        Some(1)
    );

    // Import clears internally then re-inserts.
    import_json_impl(&conn, &payload).expect("import round-trip");

    let after = count_all(&conn);
    assert_eq!(after.tasks, before.tasks);
    assert_eq!(after.sessions, before.sessions);
    assert_eq!(after.logs, before.logs);
    assert_eq!(after.notes, before.notes);
    assert_eq!(after.achievements, before.achievements);

    let link: Option<i64> = conn
        .query_row(
            "SELECT rescheduled_to FROM task_sessions WHERE id=?1",
            params![session_a],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(link, Some(session_b), "A.rescheduled_to must equal B.id");

    let archived_after: i64 = conn
        .query_row("SELECT archived FROM tasks WHERE id=3", [], |r| r.get(0))
        .unwrap();
    assert_eq!(archived_after, 1);
    let pinned_after: i64 = conn
        .query_row("SELECT pinned FROM notes WHERE id=1", [], |r| r.get(0))
        .unwrap();
    let unpinned_after: i64 = conn
        .query_row("SELECT pinned FROM notes WHERE id=2", [], |r| r.get(0))
        .unwrap();
    assert_eq!(pinned_after, 1);
    assert_eq!(unpinned_after, 0);

    let textbook_null: Option<String> = conn
        .query_row("SELECT textbook FROM tasks WHERE id=1", [], |r| r.get(0))
        .unwrap();
    assert!(textbook_null.is_none());
    let textbook_keep: Option<String> = conn
        .query_row("SELECT textbook FROM tasks WHERE id=2", [], |r| r.get(0))
        .unwrap();
    assert_eq!(textbook_keep.as_deref(), Some("必修一"));
    let self_note_keep: Option<String> = conn
        .query_row("SELECT self_note FROM task_sessions WHERE id=11", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(self_note_keep.as_deref(), Some("状态不错"));
    let self_note_null: Option<String> = conn
        .query_row("SELECT self_note FROM task_sessions WHERE id=12", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(self_note_null.is_none());

    // A 段：有值则保留 created_at / updated_at（COALESCE 原值）。
    let created_after: String = conn
        .query_row("SELECT created_at FROM tasks WHERE id=1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(created_after, created_main);
    let updated_after: String = conn
        .query_row("SELECT updated_at FROM notes WHERE id=1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(updated_after, note_updated);

    let (xp, level, streak, longest, last): (i64, i64, i64, i64, Option<String>) = conn
        .query_row(
            "SELECT total_xp, current_level, current_streak, longest_streak, last_done_date FROM user_stats WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap();
    assert_eq!(xp, 350);
    assert_eq!(level, 3);
    assert_eq!(streak, 4);
    assert_eq!(longest, 7);
    assert_eq!(last.as_deref(), Some("2026-11-03"));

    // session_id null vs non-null logs survived.
    let linked: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM actual_logs WHERE session_id IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let unlinked: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM actual_logs WHERE session_id IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(linked, 1);
    assert_eq!(unlinked, 2);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn import_failure_rolls_back_to_pre_import_state() {
    let (path, conn) = open_rusqlite_migrated().await;
    let (_a, _b) = seed_full_dataset(&conn);
    let before = count_all(&conn);
    let xp_before: i64 = conn
        .query_row("SELECT total_xp FROM user_stats WHERE id=1", [], |r| {
            r.get(0)
        })
        .unwrap();

    // Export a good payload, then poison rescheduled_to to a missing id.
    let mut payload: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse");
    let sessions = payload
        .get_mut("task_sessions")
        .and_then(|v| v.as_array_mut())
        .expect("sessions array");
    let poisoned = sessions
        .iter_mut()
        .find(|s| s.get("status").and_then(|v| v.as_str()) == Some("rescheduled"))
        .expect("rescheduled session");
    poisoned["rescheduled_to"] = serde_json::json!(999_999);

    let err = import_json_impl(&conn, &payload.to_string());
    assert!(err.is_err(), "import with dangling rescheduled_to must Err");

    let after = count_all(&conn);
    assert_eq!(after.tasks, before.tasks, "tasks count must roll back");
    assert_eq!(
        after.sessions, before.sessions,
        "sessions count must roll back"
    );
    assert_eq!(after.logs, before.logs, "logs count must roll back");
    assert_eq!(after.notes, before.notes, "notes count must roll back");
    assert_eq!(
        after.achievements, before.achievements,
        "achievements count must roll back"
    );
    let xp_after: i64 = conn
        .query_row("SELECT total_xp FROM user_stats WHERE id=1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(xp_after, xp_before, "user_stats must roll back");

    // Original self-ref still intact (not half-cleared).
    let link: Option<i64> = conn
        .query_row(
            "SELECT rescheduled_to FROM task_sessions WHERE id=10",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(link, Some(20));

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn import_preserves_foreign_key_integrity() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);
    let payload = export_json_impl(&conn).unwrap();
    import_json_impl(&conn, &payload).expect("import");
    assert_fk_ok(&conn);
    let _ = std::fs::remove_file(&path);
}

/// 导入只 `UPDATE user_stats ... WHERE id=1` 时，若 id=1 行缺失则
/// UPDATE 为 0 行 noop 仍返回 Ok，XP/连击永久写不回。本用例锁 UPSERT（或
/// UPDATE+INSERT）必须在同一事务内重建 id=1。
#[tokio::test]
async fn import_user_stats_update_is_noop_when_id_1_row_missing() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);

    let mut payload: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse export");
    payload["user_stats"] = serde_json::json!({
        "total_xp": 350,
        "current_level": 3,
        "current_streak": 4,
        "longest_streak": 7,
        "last_done_date": "2026-11-03",
    });

    conn.execute("DELETE FROM user_stats", [])
        .expect("delete user_stats to simulate missing id=1");
    let missing: i64 = conn
        .query_row("SELECT COUNT(*) FROM user_stats", [], |r| r.get(0))
        .unwrap();
    assert_eq!(missing, 0, "precondition: user_stats empty");

    let result = import_json_impl(&conn, &payload.to_string());
    // a. 当前实现 UPDATE 0 行仍 Ok；修复后也应 Ok（重建行而非失败）。
    assert!(
        result.is_ok(),
        "import must Ok even when id=1 was missing: {result:?}"
    );

    // b. 导入后必须有恰好一行 id=1，且字段与 payload 一致。
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM user_stats", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1, "user_stats must have exactly one row after import");
    let (id, xp, level, streak, longest, last): (i64, i64, i64, i64, i64, Option<String>) = conn
        .query_row(
            "SELECT id, total_xp, current_level, current_streak, longest_streak, last_done_date FROM user_stats",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .expect("user_stats id=1 row must exist after import");
    assert_eq!(id, 1);
    assert_eq!(xp, 350);
    assert_eq!(level, 3);
    assert_eq!(streak, 4);
    assert_eq!(longest, 7);
    assert_eq!(last.as_deref(), Some("2026-11-03"));

    let _ = std::fs::remove_file(&path);
}

/// C 段确认：导入不关 `PRAGMA foreign_keys`（连接打开时为 ON）；
/// 悬空 `session_id` 在 INSERT 时被 FK 拦住并整单回滚。本用例进一步要求
/// 写入前校验给出明确错误（优先修复 A），NULL session_id 仍合法（见 B）。
#[tokio::test]
async fn import_rejects_actual_log_with_dangling_session_id() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);
    let before = count_all(&conn);
    let logs_before = before.logs;

    let mut payload: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse export");
    let logs = payload
        .get_mut("actual_logs")
        .and_then(|v| v.as_array_mut())
        .expect("actual_logs array");
    logs.push(serde_json::json!({
        "id": 999,
        "date": "2026-11-03",
        "start_at": null,
        "end_at": null,
        "duration_min": 15,
        "subject": null,
        "method": null,
        "tag_type": "study",
        "session_id": 9999,
        "note": "dangling",
        "created_at": "2026-11-03 21:00:00",
    }));

    let err = import_json_impl(&conn, &payload.to_string());
    assert!(
        err.is_err(),
        "dangling session_id=9999 must Err (FK on / pre-check), got Ok"
    );
    let msg = err.unwrap_err();
    assert!(
        msg.contains("9999")
            && (msg.contains("session_id")
                || msg.contains("dangling")
                || msg.contains("actual_logs")),
        "a. error must name the dangling session_id / log: {msg}"
    );

    let after = count_all(&conn);
    assert_eq!(after.tasks, before.tasks, "b. tasks rolled back");
    assert_eq!(after.sessions, before.sessions, "b. sessions rolled back");
    assert_eq!(after.logs, logs_before, "b. actual_logs rolled back");
    assert_eq!(after.notes, before.notes, "b. notes rolled back");
    assert_eq!(
        after.achievements, before.achievements,
        "b. achievements rolled back"
    );
    assert_fk_ok(&conn); // c. no FK violations left behind

    let _ = std::fs::remove_file(&path);
}

/// 手动补记：`session_id` NULL 合法；预校验不得把 NULL 当成悬空。
#[tokio::test]
async fn import_allows_actual_log_with_null_session_id() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);

    let mut payload: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse export");
    let logs = payload
        .get_mut("actual_logs")
        .and_then(|v| v.as_array_mut())
        .expect("actual_logs array");
    // Drop existing logs; keep one explicit NULL session_id row.
    logs.clear();
    logs.push(serde_json::json!({
        "id": 501,
        "date": "2026-11-04",
        "start_at": "2026-11-04T10:00:00",
        "end_at": "2026-11-04T10:30:00",
        "duration_min": 30,
        "subject": null,
        "method": null,
        "tag_type": "sport",
        "session_id": null,
        "note": "manual",
        "created_at": "2026-11-04 10:30:00",
    }));

    import_json_impl(&conn, &payload.to_string()).expect("null session_id must import Ok");

    let (n, sid): (i64, Option<i64>) = conn
        .query_row(
            "SELECT COUNT(*), (SELECT session_id FROM actual_logs WHERE id=501) FROM actual_logs",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(n, 1);
    assert!(sid.is_none(), "session_id must stay NULL");
    assert_fk_ok(&conn);

    let _ = std::fs::remove_file(&path);
}

/// 选择：**拒绝**（返回 Err），不静默接受 id≠1。
/// 若静默写入 id=2 会撞上 CHECK(id=1)；若忽略 id 仍 UPSERT 到 1，
/// 则错误 payload 看似成功，掩盖导出/手改 JSON 的污染。故显式 Err。
#[tokio::test]
async fn import_rejects_user_stats_payload_with_wrong_id() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);
    let xp_before: i64 = conn
        .query_row("SELECT total_xp FROM user_stats WHERE id=1", [], |r| {
            r.get(0)
        })
        .unwrap();

    let mut payload: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse export");
    payload["user_stats"] = serde_json::json!({
        "id": 2,
        "total_xp": 999,
        "current_level": 9,
        "current_streak": 9,
        "longest_streak": 9,
        "last_done_date": "2099-01-01",
    });

    let err = import_json_impl(&conn, &payload.to_string());
    assert!(err.is_err(), "user_stats.id=2 must Err, got Ok");

    let xp_after: i64 = conn
        .query_row("SELECT total_xp FROM user_stats WHERE id=1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(xp_after, xp_before, "reject must roll back; id=1 unchanged");
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM user_stats", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1, "still exactly one user_stats row");

    let _ = std::fs::remove_file(&path);
}

/// 选项 B：导入非法 notes.color 归一为 `"yellow"`，整单仍成功（非拒绝）。
#[tokio::test]
async fn import_normalizes_invalid_color_to_default() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);

    let mut payload: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse export");
    let notes = payload
        .get_mut("notes")
        .and_then(|v| v.as_array_mut())
        .expect("notes array");
    assert!(!notes.is_empty(), "seed must include notes");
    let target_id = notes[0]
        .get("id")
        .and_then(|v| v.as_i64())
        .expect("note id");
    notes[0]["color"] = serde_json::json!("neon");

    import_json_impl(&conn, &payload.to_string()).expect("import with neon color");

    let color: String = conn
        .query_row(
            "SELECT color FROM notes WHERE id=?1",
            params![target_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(color, "yellow", "neon must normalize to yellow on import");

    let _ = std::fs::remove_file(&path);
}

/// A 段确认：导入对 `user_achievements` 使用 `INSERT OR IGNORE`（非裸 INSERT）；
/// `achievement_id` 为主键。payload 内重复 id 时保留**第一条**，后条静默忽略。
#[tokio::test]
async fn import_user_achievements_duplicate_ids_are_idempotent() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);
    let before = count_all(&conn);

    let mut payload: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse export");
    payload["user_achievements"] = serde_json::json!([
        {
            "achievement_id": "first_round",
            "unlocked_at": "2026-11-01 10:00:00"
        },
        {
            "achievement_id": "first_round",
            "unlocked_at": "2099-12-31 23:59:59"
        },
        {
            "achievement_id": "comeback",
            "unlocked_at": "2026-11-02 12:00:00"
        }
    ]);

    import_json_impl(&conn, &payload.to_string()).expect("a. duplicate achievement_id must Ok");

    let n_first: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM user_achievements WHERE achievement_id = 'first_round'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n_first, 1, "b. first_round must be a single row");

    // c. INSERT OR IGNORE：主键冲突时忽略后条，保留 payload 中第一条的 unlocked_at。
    let unlocked: String = conn
        .query_row(
            "SELECT unlocked_at FROM user_achievements WHERE achievement_id = 'first_round'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        unlocked, "2026-11-01 10:00:00",
        "c. first payload row wins under INSERT OR IGNORE"
    );

    let after = count_all(&conn);
    assert_eq!(
        after.tasks, before.tasks,
        "d. tasks unchanged vs pre-import seed"
    );
    assert_eq!(after.sessions, before.sessions, "d. sessions unchanged");
    assert_eq!(after.logs, before.logs, "d. logs unchanged");
    assert_eq!(after.notes, before.notes, "d. notes unchanged");
    assert_eq!(
        after.achievements, 2,
        "d. unique achievements only (first_round + comeback)"
    );

    let _ = std::fs::remove_file(&path);
}

/// 连续导入同一 payload：每次先 `DELETE FROM user_achievements` 再 INSERT，
/// 行数不翻倍；同 payload 下 `unlocked_at` 与第一次导入后一致（实质是用 payload 重写）。
#[tokio::test]
async fn import_user_achievements_twice_keeps_single_row_per_id() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);

    let payload = export_json_impl(&conn).expect("export");
    let parsed: Value = serde_json::from_str(&payload).expect("parse");
    let expected_achievements = parsed["user_achievements"]
        .as_array()
        .expect("user_achievements array");
    assert_eq!(
        expected_achievements.len(),
        2,
        "seed export must include 2 achievements"
    );

    import_json_impl(&conn, &payload).expect("a. first import Ok");
    let after_first = count_all(&conn);
    let unlocked_after_first: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT achievement_id, unlocked_at FROM user_achievements ORDER BY achievement_id",
            )
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    assert_eq!(unlocked_after_first.len(), 2);

    import_json_impl(&conn, &payload).expect("a. second import Ok");
    let after_second = count_all(&conn);

    let per_id: i64 = conn
        .query_row(
            "SELECT MAX(cnt) FROM (
                SELECT COUNT(*) AS cnt FROM user_achievements GROUP BY achievement_id
             )",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(per_id, 1, "b. each achievement_id appears once");

    let unlocked_after_second: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT achievement_id, unlocked_at FROM user_achievements ORDER BY achievement_id",
            )
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    // c. 实现语义：导入路径先 DELETE 再按 payload INSERT（非「保留旧 unlocked_at」）。
    // 同 payload 连续导入 → 第二次与第一次导入后的 unlocked_at 相同。
    assert_eq!(
        unlocked_after_second, unlocked_after_first,
        "c. same payload re-import keeps unlocked_at identical to first import"
    );

    assert_eq!(
        after_second.tasks, after_first.tasks,
        "d. tasks not doubled"
    );
    assert_eq!(
        after_second.sessions, after_first.sessions,
        "d. sessions not doubled"
    );
    assert_eq!(after_second.logs, after_first.logs, "d. logs not doubled");
    assert_eq!(
        after_second.notes, after_first.notes,
        "d. notes not doubled"
    );
    assert_eq!(
        after_second.achievements, after_first.achievements,
        "d. achievements count stable across re-import"
    );
    assert_eq!(after_second.achievements, 2);

    let _ = std::fs::remove_file(&path);
}

/// `user_achievements.achievement_id` REFERENCES `achievements(id)`。
/// 导入用 `INSERT OR IGNORE` 会吞掉 FK 失败，故实现侧在清空前显式校验悬空 id，
/// 风格对齐 `import_rejects_actual_log_with_dangling_session_id`。
#[tokio::test]
async fn import_user_achievements_payload_with_dangling_reference() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);
    let before = count_all(&conn);
    let xp_before: i64 = conn
        .query_row("SELECT total_xp FROM user_stats WHERE id=1", [], |r| {
            r.get(0)
        })
        .unwrap();

    let mut payload: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse export");
    let achievements = payload
        .get_mut("user_achievements")
        .and_then(|v| v.as_array_mut())
        .expect("user_achievements array");
    achievements.push(serde_json::json!({
        "achievement_id": "not_a_real_achievement",
        "unlocked_at": "2026-11-04 12:00:00"
    }));

    let err = import_json_impl(&conn, &payload.to_string());
    assert!(
        err.is_err(),
        "dangling achievement_id must Err (pre-check), got Ok"
    );
    let msg = err.unwrap_err();
    assert!(
        msg.contains("not_a_real_achievement")
            && (msg.contains("achievement_id")
                || msg.contains("dangling")
                || msg.contains("user_achievements")),
        "error must name the dangling achievement_id: {msg}"
    );

    let after = count_all(&conn);
    assert_eq!(after.tasks, before.tasks, "tasks rolled back");
    assert_eq!(after.sessions, before.sessions, "sessions rolled back");
    assert_eq!(after.logs, before.logs, "logs rolled back");
    assert_eq!(after.notes, before.notes, "notes rolled back");
    assert_eq!(
        after.achievements, before.achievements,
        "user_achievements rolled back"
    );
    let xp_after: i64 = conn
        .query_row("SELECT total_xp FROM user_stats WHERE id=1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(xp_after, xp_before, "user_stats unchanged on reject");
    assert_fk_ok(&conn);

    let _ = std::fs::remove_file(&path);
}

/// 护栏：未来新增用户表时，若未同步 `export_json_impl`，本测试自动红灯。
///
/// A 段：payload 顶层 = `version` / `exported_at` + 十张表键（含 `app_settings`、`imported_textbooks`、`user_profile`、`exam_records`）；库内另有目录表
/// `achievements`（`INTENTIONAL_EXPORT_OMISSIONS`）。导出为硬编码列表，见 AGENTS.md。
#[tokio::test]
async fn export_json_includes_every_user_table() {
    let (path, conn) = open_rusqlite_migrated().await;

    let actual_tables = list_user_tables(&conn);
    let payload: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse export");
    let exported_tables = exported_table_keys(&payload);

    export_table_coverage_error(&actual_tables, &exported_tables)
        .unwrap_or_else(|msg| panic!("{msg}"));

    // 自证：临时新表未进导出时必须失败（否则本护栏只是摆设）。
    conn.execute("CREATE TABLE _probe_table (id INTEGER PRIMARY KEY)", [])
        .expect("create probe table");
    let actual_with_probe = list_user_tables(&conn);
    let payload_after: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse export after probe");
    let exported_after = exported_table_keys(&payload_after);
    let probe_err = export_table_coverage_error(&actual_with_probe, &exported_after);
    match probe_err {
        Ok(()) => panic!(
            "expected coverage failure after CREATE TABLE _probe_table, but check passed \
             (export still covers all tables — guard is a no-op)"
        ),
        Err(msg) => {
            eprintln!("probe expected failure sample:\n{msg}");
            assert!(
                msg.contains("_probe_table"),
                "failure must name _probe_table as missing from export; got:\n{msg}"
            );
            assert!(
                msg.contains("in DB but not exported"),
                "failure must report DB−export diff; got:\n{msg}"
            );
        }
    }

    conn.execute("DROP TABLE _probe_table", [])
        .expect("drop probe table");
    let restored = list_user_tables(&conn);
    assert_eq!(
        restored, actual_tables,
        "_probe_table must be gone after DROP"
    );
    export_table_coverage_error(&restored, &exported_table_keys(&payload))
        .unwrap_or_else(|msg| panic!("coverage must pass again after DROP: {msg}"));

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn imported_textbook_survives_export_import() {
    let (path, conn) = open_rusqlite_migrated().await;
    let outline = r#"{"subject":"语文","version":"部编版","volume":"必修上册","chapters":[{"chapter":"第一单元","sections":["1 沁园春·长沙"]}]}"#;
    conn.execute(
        r#"INSERT INTO imported_textbooks (subject, version, volume, outline_json, created_at, updated_at)
           VALUES ('语文', '部编版', '必修上册', ?1, '2026-11-05 10:00:00', '2026-11-05 10:00:00')"#,
        [outline],
    )
    .unwrap();

    let exported = export_json_impl(&conn).unwrap();
    conn.execute("DELETE FROM imported_textbooks", []).unwrap();
    import_json_impl(&conn, &exported).unwrap();

    let stored: String = conn
        .query_row(
            "SELECT outline_json FROM imported_textbooks WHERE subject='语文'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, outline);
    let _ = std::fs::remove_file(&path);
}

fn count_achievements_catalog(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM achievements", [], |r| r.get(0))
        .expect("count achievements catalog")
}

/// Same rows as `20261104000000_init.sql` / rusqlite bootstrap seed.
fn reseed_achievements_catalog(conn: &Connection) {
    conn.execute_batch(
        r#"
        INSERT OR IGNORE INTO achievements (id, name, description) VALUES
          ('first_round', '首轮完成', '某主线任务当前轮进度达标'),
          ('comeback', '逆风翻盘', '改期后完成且自评≥4星'),
          ('balanced', '均衡发展', '一周内主线与副本均有完成'),
          ('streak_5', '持续在场', '连续5天有完成记录');
        "#,
    )
    .expect("reseed achievements catalog");
}

/// achievements 目录是有意不导出的（它是应用自带的种子数据，
/// 随版本发布），因此导入依赖本机目录存在。
/// 目录被清空时拒绝导入是正确行为，不是 bug。
/// 若用户遇到此错误，应重新执行种子迁移或重装应用。
///
/// A 段确认：预校验比对的是本机 `achievements` 表，不是 payload 里的目录
/// （payload 本就不含 `achievements` key）。
#[tokio::test]
async fn import_rejects_user_achievements_when_achievements_catalog_wiped() {
    let (path, conn) = open_rusqlite_migrated().await;

    let mut catalog_n = count_achievements_catalog(&conn);
    if catalog_n == 0 {
        reseed_achievements_catalog(&conn);
        catalog_n = count_achievements_catalog(&conn);
    }
    assert!(
        catalog_n >= 4,
        "migrated DB must have achievement catalog seeds; got {catalog_n}"
    );

    // Payload mirrors real export: no top-level "achievements", only user_achievements.
    let mut payload: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse export");
    assert!(
        payload.get("achievements").is_none(),
        "export must omit achievements catalog key"
    );
    payload["user_achievements"] = serde_json::json!([
        {
            "achievement_id": "first_round",
            "unlocked_at": "2026-11-01 12:00:00"
        }
    ]);
    let payload_str = payload.to_string();

    // Step 1: catalog present → Ok, unlock row written.
    import_json_impl(&conn, &payload_str).expect("import Ok with catalog present");
    let ua: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM user_achievements WHERE achievement_id = 'first_round'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(ua, 1, "first_round must be written on successful import");

    // Step 2: wipe local catalog (FK off so referencing user_achievements rows don't block).
    conn.execute_batch(
        "PRAGMA foreign_keys = OFF; DELETE FROM achievements; PRAGMA foreign_keys = ON;",
    )
    .expect("wipe achievements catalog");
    assert_eq!(
        count_achievements_catalog(&conn),
        0,
        "catalog must be empty before second import"
    );

    let before = count_all(&conn);
    let xp_before: i64 = conn
        .query_row("SELECT total_xp FROM user_stats WHERE id=1", [], |r| {
            r.get(0)
        })
        .unwrap();
    let catalog_before = count_achievements_catalog(&conn);

    let err = import_json_impl(&conn, &payload_str);
    assert!(
        err.is_err(),
        "a. empty catalog + user_achievements must Err, got Ok"
    );
    let msg = err.unwrap_err();
    assert!(
        msg.contains("first_round")
            && (msg.contains("achievement_id")
                || msg.contains("dangling")
                || msg.contains("user_achievements")
                || msg.contains("achievements")),
        "a. error must name user_achievements achievement_id missing from local catalog: {msg}"
    );

    let after = count_all(&conn);
    assert_eq!(after.tasks, before.tasks, "b. tasks unchanged");
    assert_eq!(after.sessions, before.sessions, "b. sessions unchanged");
    assert_eq!(after.logs, before.logs, "b. logs unchanged");
    assert_eq!(after.notes, before.notes, "b. notes unchanged");
    assert_eq!(
        after.achievements, before.achievements,
        "b. user_achievements unchanged (pre-check rejects before clear)"
    );
    let xp_after: i64 = conn
        .query_row("SELECT total_xp FROM user_stats WHERE id=1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(xp_after, xp_before, "b. user_stats unchanged");
    assert_eq!(
        count_achievements_catalog(&conn),
        catalog_before,
        "b. catalog stays empty (import must not rewrite catalog)"
    );

    // Step 3: reseed catalog → same payload imports Ok again.
    reseed_achievements_catalog(&conn);
    assert!(
        count_achievements_catalog(&conn) >= 4,
        "c. catalog reseeded"
    );
    import_json_impl(&conn, &payload_str).expect("c. import Ok after reseed");
    let ua_after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM user_achievements WHERE achievement_id = 'first_round'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(ua_after, 1, "c. first_round present after reseed import");

    let _ = std::fs::remove_file(&path);
}

/// A 段确认：导出 payload 顶层不含目录表 `achievements`。
/// 与 `export_json_includes_every_user_table` 配合——后者经
/// `INTENTIONAL_EXPORT_OMISSIONS` 白名单排除，避免误报遗漏。
#[tokio::test]
async fn export_payload_does_not_include_achievements_catalog() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);

    let payload: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse export");
    let keys: BTreeSet<&str> = payload
        .as_object()
        .expect("object")
        .keys()
        .map(|k| k.as_str())
        .collect();
    assert!(
        !keys.contains("achievements"),
        "export top-level keys must not include achievements; got {keys:?}"
    );
    assert!(
        keys.contains("user_achievements"),
        "user unlocks must still export; keys={keys:?}"
    );
    assert!(
        INTENTIONAL_EXPORT_OMISSIONS.contains(&"achievements"),
        "guard whitelist must list achievements so coverage test does not treat it as a miss"
    );

    let _ = std::fs::remove_file(&path);
}

/// 空 `user_achievements` 导入不得触碰目录表（无 DELETE/覆盖 achievements）。
#[tokio::test]
async fn import_with_empty_user_achievements_does_not_touch_catalog() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);

    let catalog_before = count_achievements_catalog(&conn);
    assert!(
        catalog_before >= 4,
        "catalog must be seeded before import; got {catalog_before}"
    );
    let catalog_ids_before: BTreeSet<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM achievements ORDER BY id")
            .unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<Result<BTreeSet<_>, _>>()
            .unwrap()
    };

    let mut payload: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse export");
    payload["user_achievements"] = serde_json::json!([]);

    import_json_impl(&conn, &payload.to_string()).expect("empty user_achievements must Ok");

    assert_eq!(
        count_achievements_catalog(&conn),
        catalog_before,
        "achievements catalog row count must not change"
    );
    let catalog_ids_after: BTreeSet<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM achievements ORDER BY id")
            .unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<Result<BTreeSet<_>, _>>()
            .unwrap()
    };
    assert_eq!(
        catalog_ids_after, catalog_ids_before,
        "catalog ids must be unchanged (not cleared/overwritten)"
    );

    let ua: i64 = conn
        .query_row("SELECT COUNT(*) FROM user_achievements", [], |r| r.get(0))
        .unwrap();
    assert_eq!(ua, 0, "empty payload clears user unlocks only");

    let _ = std::fs::remove_file(&path);
}

/// B 段确认：`export_json_impl` 对 user_stats 使用 `query_row`（非 query_optional）；
/// 缺 id=1 时返回 Err，不得静默产出缺字段的备份。
///
/// user_stats 是单行表，缺失代表数据损坏；
/// 导出必须显式失败，不能产出不完整备份。
#[tokio::test]
async fn export_json_errors_when_user_stats_id_1_row_missing() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);

    let ok_payload = export_json_impl(&conn).expect("precondition: export succeeds with id=1");
    let ok: Value = serde_json::from_str(&ok_payload).expect("parse ok export");
    assert!(
        ok.get("user_stats").is_some(),
        "baseline export must include user_stats; keys={:?}",
        ok.as_object().map(|o| o.keys().collect::<Vec<_>>())
    );
    assert!(
        ok.get("tasks")
            .and_then(|t| t.as_array())
            .map(|a| !a.is_empty())
            == Some(true),
        "baseline must have tasks"
    );

    conn.execute("DELETE FROM user_stats", [])
        .expect("delete user_stats to simulate corruption");
    let missing: i64 = conn
        .query_row("SELECT COUNT(*) FROM user_stats", [], |r| r.get(0))
        .unwrap();
    assert_eq!(missing, 0, "precondition: user_stats empty");

    // query_row path: Result::Err, no panic.
    let err = export_json_impl(&conn);
    assert!(err.is_err(), "missing user_stats id=1 must Err, got Ok");
    let msg = err.unwrap_err();
    let msg_l = msg.to_lowercase();
    assert!(
        msg_l.contains("user_stats")
            || msg_l.contains("id=1")
            || msg_l.contains("id = 1")
            || msg.contains("数据损坏")
            || msg.contains("缺失"),
        "Err must name user_stats / id=1 / corruption; got: {msg}"
    );

    let _ = std::fs::remove_file(&path);
}

/// B 段确认：`export_json_impl` 纯在内存组装 JSON 字符串，不写临时文件再重命名；
/// 因此缺 id=1 时无 partial file 可断言。Tauri `export_json` 同样只返回 String。
#[tokio::test]
#[ignore = "export_json_impl 纯内存组装 JSON，不写临时文件；无 partial file 可断言"]
async fn export_failure_does_not_write_partial_file() {}

/// B 段确认：导出对 user_stats 是 `SELECT … current_level` 直读，不调用
/// `level_from_total_xp` 重算。
///
/// 导出是数据快照，不是数据修复。level 与 XP 不一致时原样带出，
/// 由用户在应用内看到实际等级，不在导出路径静默改写。
#[tokio::test]
async fn export_keeps_current_level_when_inconsistent_with_total_xp() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);

    // 350 XP 按公式至少 3 级；故意写成 current_level=1。
    conn.execute(
        "UPDATE user_stats SET total_xp=350, current_level=1 WHERE id=1",
        [],
    )
    .expect("seed inconsistent level/xp");

    let db_level: i64 = conn
        .query_row("SELECT current_level FROM user_stats WHERE id=1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(db_level, 1, "precondition: DB current_level=1");

    let exported = export_json_impl(&conn).expect("export must Ok despite mismatch");
    let payload: Value = serde_json::from_str(&exported).expect("parse export");

    assert_eq!(payload["user_stats"]["total_xp"], 350);
    assert_eq!(
        payload["user_stats"]["current_level"], 1,
        "export must keep DB current_level=1, not recompute from total_xp"
    );

    let _ = std::fs::remove_file(&path);
}

/// 承接上一用例：level/XP 不一致不得使导出变 Err（防止日后加「导出前校验」当致命错）。
#[tokio::test]
async fn export_does_not_fail_on_level_xp_mismatch() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);

    conn.execute(
        "UPDATE user_stats SET total_xp=350, current_level=1 WHERE id=1",
        [],
    )
    .expect("seed inconsistent level/xp");

    let result = export_json_impl(&conn);
    assert!(
        result.is_ok(),
        "level/XP mismatch must not make export Err: {result:?}"
    );

    let _ = std::fs::remove_file(&path);
}

/// 导入同样原样写入；不一致不重算。
/// （`import_user_stats_update_is_noop_when_id_1_row_missing` 已锁 UPSERT 按 payload
/// 写入 current_level，但用的是一致的 350/3；本条专锁不一致 350/1。）
#[tokio::test]
async fn import_preserves_inconsistent_level_xp_as_is() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);

    let mut payload: Value =
        serde_json::from_str(&export_json_impl(&conn).unwrap()).expect("parse export");
    payload["user_stats"] = serde_json::json!({
        "total_xp": 350,
        "current_level": 1,
        "current_streak": 0,
        "longest_streak": 0,
        "last_done_date": null,
    });

    import_json_impl(&conn, &payload.to_string()).expect("import inconsistent stats must Ok");

    let (xp, level): (i64, i64) = conn
        .query_row(
            "SELECT total_xp, current_level FROM user_stats WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(xp, 350);
    assert_eq!(
        level, 1,
        "import must keep payload current_level=1, not recompute from total_xp"
    );

    let _ = std::fs::remove_file(&path);
}

/// 承接缺行失败：手动恢复 id=1 后导出须再次成功（不被上次失败污染）。
#[tokio::test]
async fn export_after_user_stats_restored_succeeds() {
    let (path, conn) = open_rusqlite_migrated().await;
    seed_full_dataset(&conn);

    conn.execute("DELETE FROM user_stats", [])
        .expect("delete user_stats");
    let fail = export_json_impl(&conn);
    assert!(fail.is_err(), "precondition: missing id=1 must Err");

    conn.execute(
        r#"INSERT INTO user_stats (id, total_xp, current_level, current_streak, longest_streak, last_done_date)
           VALUES (1, 0, 1, 0, 0, NULL)"#,
        [],
    )
    .expect("restore singleton id=1");

    let restored = export_json_impl(&conn).expect("export must succeed after restore");
    let payload: Value = serde_json::from_str(&restored).expect("parse");
    assert!(
        payload.get("user_stats").is_some(),
        "payload must include user_stats after restore"
    );
    // 导出格式不序列化 id（导入缺省视为 1）；以库内单例 + 字段值为准。
    let id: i64 = conn
        .query_row("SELECT id FROM user_stats", [], |r| r.get(0))
        .expect("singleton row");
    assert_eq!(id, 1, "restored row must be id=1");
    assert_eq!(payload["user_stats"]["total_xp"], 0);
    assert_eq!(payload["user_stats"]["current_level"], 1);
    assert_eq!(payload["user_stats"]["current_streak"], 0);
    assert_eq!(payload["user_stats"]["longest_streak"], 0);
    assert!(payload["user_stats"]["last_done_date"].is_null());

    let _ = std::fs::remove_file(&path);
}

/// 过顶快照：`current_round=5`、`total_rounds=2`。
/// round=1 的 done 场次用来证明进度环按当前轮过滤，不把旧轮算进 round 5。
fn over_cap_payload() -> Value {
    serde_json::json!({
        "version": 1,
        "tasks": [{
            "id": 7,
            "title": "过顶主线",
            "type": "main",
            "subject": "数学",
            "textbook": null,
            "unit_name": "课",
            "total_units": 20,
            "total_rounds": 2,
            "current_round": 5,
            "color": "#F97316",
            "archived": 0,
            "created_at": "2026-11-01 10:00:00"
        }],
        "task_sessions": [{
            "id": 70,
            "task_id": 7,
            "date": "2026-11-01",
            "start_time": "09:00",
            "end_time": "10:00",
            "round": 1,
            "status": "done",
            "planned_units": 8,
            "actual_units": 8,
            "self_rating": 3,
            "self_note": null,
            "rescheduled_to": null,
            "xp_awarded": 0,
            "created_at": "2026-11-01 11:00:00"
        }],
        "actual_logs": [],
        "notes": [],
        "user_stats": {
            "total_xp": 0,
            "current_level": 1,
            "current_streak": 0,
            "longest_streak": 0,
            "last_done_date": null
        },
        "user_achievements": []
    })
}

/// 导入是数据快照，不做业务校验。current_round > total_rounds 是
/// advance_round 无封顶允许的合法状态，导入应原样保留，
/// 由进度环/详情页按各自语义渲染。
#[tokio::test]
async fn import_preserves_current_round_above_total_rounds() {
    let (path, conn) = open_rusqlite_migrated().await;
    let payload = over_cap_payload();

    import_json_impl(&conn, &payload.to_string()).expect("a. over-cap import must Ok");

    let (current_round, total_rounds): (i64, i64) = conn
        .query_row(
            "SELECT current_round, total_rounds FROM tasks WHERE id=7",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("b. imported task row");
    assert_eq!(current_round, 5, "b. current_round kept as 5");
    assert_eq!(total_rounds, 2, "b. total_rounds kept as 2");
    assert_fk_ok(&conn);

    let _ = std::fs::remove_file(&path);
}

/// 与 `progress_ring_on_round_past_total_rounds` 互补：那条经 advance_round 过顶，
/// 这条由导入带入 `current_round=5`。`task_progress` 按 round=5 过滤，旧轮 done 不计入。
#[tokio::test]
async fn import_over_cap_state_does_not_crash_task_detail() {
    let (path, conn) = open_rusqlite_migrated().await;
    import_json_impl(&conn, &over_cap_payload().to_string()).expect("import over-cap");

    let progress = task_progress_impl(&conn, 7).expect("task_progress must Ok, not panic");
    assert_eq!(
        progress.round_units, 0,
        "round=5 has no done sessions; round=1 actual_units=8 must stay out of the ring"
    );
    assert_eq!(progress.total_units_done, 8);

    let _ = std::fs::remove_file(&path);
}

/// `tasks` 建表没有 `CHECK(current_round <= total_rounds)`（`db.rs` 与 init 迁移）。
/// 过顶不是约束违反。若以后加上这条 CHECK，去掉 ignore，改为断言导入 Err 并回滚。
#[tokio::test]
#[ignore = "current_round 无上界，由应用层语义保证（advance_round 允许过顶、导入原样保留）"]
async fn import_rejects_current_round_when_it_violates_check_constraint() {}

/// 导入过顶后再导出：`current_round` 仍是 5，导出不重算、不钳制成 total_rounds。
#[tokio::test]
async fn export_round_trip_preserves_over_cap_state() {
    let (path, conn) = open_rusqlite_migrated().await;
    import_json_impl(&conn, &over_cap_payload().to_string()).expect("import over-cap");

    let exported = export_json_impl(&conn).expect("export after over-cap import");
    let parsed: Value = serde_json::from_str(&exported).expect("parse export");
    let task = parsed["tasks"]
        .as_array()
        .expect("tasks")
        .iter()
        .find(|t| t["id"] == 7)
        .expect("task 7 in export");
    assert_eq!(task["current_round"], 5, "export must keep current_round=5");
    assert_eq!(task["total_rounds"], 2, "export must keep total_rounds=2");

    let _ = std::fs::remove_file(&path);
}

/// 指向 `rescheduled` session 的学习流水。
///
/// A 段：`validate_actual_log_session_refs` 只收集 payload `task_sessions.id`，
/// 不读 `status`。`rescheduled` 与 `planned` 只要 id 在集合里都通过。
/// B 段：完成路径只在 `planned`→`done` 时写入带 `session_id` 的 log；
/// `reschedule_session_impl` 拒绝非 `planned`（含 `done`）；手动补记不写 `session_id`。
/// 应用内操作产生不了「log 指向 rescheduled session」，只能由导入带入。
/// C 段：`stats_tag_type_totals` 只读 `actual_logs` 的 `date` / `tag_type`，
/// 不 JOIN `task_sessions`，也不按 `session.status` 过滤。
const RESCHEDULED_LOG_DATE: &str = "2026-11-04";
const RESCHEDULED_SESSION_ID: i64 = 10;
const RESCHEDULED_TARGET_ID: i64 = 20;
const RESCHEDULED_LOG_ID: i64 = 100;
const RESCHEDULED_LOG_MINUTES: i64 = 30;

fn rescheduled_session_log_payload() -> Value {
    serde_json::json!({
        "version": 1,
        "tasks": [{
            "id": 1,
            "title": "主线数学",
            "type": "main",
            "subject": "数学",
            "textbook": null,
            "unit_name": "课",
            "total_units": 10,
            "total_rounds": 1,
            "current_round": 1,
            "color": "#F97316",
            "archived": 0,
            "created_at": "2026-11-01 10:00:00"
        }],
        "task_sessions": [
            {
                "id": RESCHEDULED_TARGET_ID,
                "task_id": 1,
                "date": "2026-11-05",
                "start_time": "10:00",
                "end_time": "11:00",
                "round": 1,
                "status": "planned",
                "planned_units": 3,
                "actual_units": 0,
                "self_rating": null,
                "self_note": null,
                "rescheduled_to": null,
                "xp_awarded": 0,
                "created_at": "2026-11-04 12:00:00"
            },
            {
                "id": RESCHEDULED_SESSION_ID,
                "task_id": 1,
                "date": RESCHEDULED_LOG_DATE,
                "start_time": "09:00",
                "end_time": "10:00",
                "round": 1,
                "status": "rescheduled",
                "planned_units": 3,
                "actual_units": 0,
                "self_rating": null,
                "self_note": null,
                "rescheduled_to": RESCHEDULED_TARGET_ID,
                "xp_awarded": 0,
                "created_at": "2026-11-04 09:00:00"
            }
        ],
        "actual_logs": [{
            "id": RESCHEDULED_LOG_ID,
            "date": RESCHEDULED_LOG_DATE,
            "start_at": "2026-11-04T09:00:00",
            "end_at": "2026-11-04T09:30:00",
            "duration_min": RESCHEDULED_LOG_MINUTES,
            "subject": "数学",
            "method": "刷题",
            "tag_type": "study",
            "session_id": RESCHEDULED_SESSION_ID,
            "note": null,
            "created_at": "2026-11-04 10:00:00"
        }],
        "notes": [],
        "user_stats": {
            "total_xp": 0,
            "current_level": 1,
            "current_streak": 0,
            "longest_streak": 0,
            "last_done_date": null
        },
        "user_achievements": []
    })
}

/// 导入是数据快照，不校验 session status 与 log 的业务一致性。
/// 若备份中存在这类数据，恢复时原样保留，不做业务修复。
#[tokio::test]
async fn import_allows_actual_log_for_rescheduled_session() {
    let (path, conn) = open_rusqlite_migrated().await;
    let payload = rescheduled_session_log_payload();

    import_json_impl(&conn, &payload.to_string())
        .expect("a. log pointing at a rescheduled session must import Ok");

    let session_id: Option<i64> = conn
        .query_row(
            "SELECT session_id FROM actual_logs WHERE id = ?1",
            params![RESCHEDULED_LOG_ID],
            |r| r.get(0),
        )
        .expect("b. log row must exist");
    assert_eq!(
        session_id,
        Some(RESCHEDULED_SESSION_ID),
        "b. session_id stays on the rescheduled session"
    );

    let (status, rescheduled_to): (String, Option<i64>) = conn
        .query_row(
            "SELECT status, rescheduled_to FROM task_sessions WHERE id = ?1",
            params![RESCHEDULED_SESSION_ID],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("c. rescheduled session row");
    assert_eq!(
        status, "rescheduled",
        "c. import must not rewrite status to done"
    );
    assert_eq!(
        rescheduled_to,
        Some(RESCHEDULED_TARGET_ID),
        "c. rescheduled_to still points at the planned target"
    );
    assert_fk_ok(&conn);

    let _ = std::fs::remove_file(&path);
}

/// C 段：`stats_tag_type_totals` 不 JOIN `task_sessions`。
/// 指向 rescheduled session 的 study 流水按 `actual_logs` 自身计入。
/// 若此处红灯（study 合计不含这 30 分钟），是统计层按 status 丢掉了流水，
/// 先停在报告，不改统计 SQL。
#[tokio::test]
async fn imported_rescheduled_session_log_counts_in_stats() {
    let (path, conn) = open_rusqlite_migrated().await;
    import_json_impl(&conn, &rescheduled_session_log_payload().to_string())
        .expect("import rescheduled-session log");

    let path_str = path.to_string_lossy().replace('\\', "/");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&format!("sqlite:{path_str}?mode=rwc"))
        .await
        .expect("open pool on imported db");
    let rows = stats_tag_type_totals_impl(&pool, RESCHEDULED_LOG_DATE, RESCHEDULED_LOG_DATE)
        .await
        .expect("stats_tag_type_totals");
    pool.close().await;

    let study = rows
        .iter()
        .find(|row| row.tag_type == "study")
        .map(|row| row.duration_min)
        .unwrap_or(0);
    assert_eq!(
        study, RESCHEDULED_LOG_MINUTES,
        "a. study total must include the 30 minutes on the rescheduled session; \
         a lower total means stats dropped the log because of session.status"
    );

    let _ = std::fs::remove_file(&path);
}

/// 导入再导出仍是同一份快照：log 的 session_id、S 的 status、rescheduled_to 都不改写。
#[tokio::test]
async fn export_round_trip_preserves_log_for_rescheduled_session() {
    let (path, conn) = open_rusqlite_migrated().await;
    import_json_impl(&conn, &rescheduled_session_log_payload().to_string())
        .expect("import rescheduled-session log");

    let exported = export_json_impl(&conn).expect("export after import");
    let parsed: Value = serde_json::from_str(&exported).expect("parse export");

    let log = parsed["actual_logs"]
        .as_array()
        .expect("actual_logs")
        .iter()
        .find(|row| row["id"] == RESCHEDULED_LOG_ID)
        .expect("a. log must still be in the export");
    assert_eq!(
        log["session_id"], RESCHEDULED_SESSION_ID,
        "a. exported session_id stays on the rescheduled session"
    );

    let session = parsed["task_sessions"]
        .as_array()
        .expect("task_sessions")
        .iter()
        .find(|row| row["id"] == RESCHEDULED_SESSION_ID)
        .expect("rescheduled session in export");
    assert_eq!(
        session["status"], "rescheduled",
        "b. status stays rescheduled"
    );
    assert_eq!(
        session["rescheduled_to"], RESCHEDULED_TARGET_ID,
        "c. rescheduled_to still points at the planned target"
    );

    let _ = std::fs::remove_file(&path);
}

/// 即使有流水指向 S，导入也不把 `rescheduled` 改成 `done`。
/// 消除这种矛盾属于数据修复，不能藏在导入路径里。
#[tokio::test]
async fn import_does_not_auto_flip_rescheduled_to_done() {
    let (path, conn) = open_rusqlite_migrated().await;
    import_json_impl(&conn, &rescheduled_session_log_payload().to_string())
        .expect("import rescheduled-session log");

    let pointing: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM actual_logs WHERE session_id = ?1",
            params![RESCHEDULED_SESSION_ID],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        pointing, 1,
        "precondition: a log points at the rescheduled session"
    );

    let status: String = conn
        .query_row(
            "SELECT status FROM task_sessions WHERE id = ?1",
            params![RESCHEDULED_SESSION_ID],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        status, "rescheduled",
        "import must not flip status to done to paper over the log"
    );

    let _ = std::fs::remove_file(&path);
}

fn streak_snapshot(conn: &Connection) -> (i64, i64, Option<String>) {
    conn.query_row(
        "SELECT current_streak, longest_streak, last_done_date FROM user_stats WHERE id=1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .expect("user_stats streak row")
}

/// 连击与 last_done_date 脱节的快照。附一场今天的 planned session，供下一次完成使用。
fn inconsistent_streak_payload(today: &str) -> Value {
    serde_json::json!({
        "version": 1,
        "tasks": [{
            "id": 1,
            "title": "连击锚点",
            "type": "side",
            "subject": "数学",
            "textbook": null,
            "unit_name": "课",
            "total_units": null,
            "total_rounds": 1,
            "current_round": 1,
            "color": null,
            "archived": 0,
            "created_at": "2026-11-01 10:00:00"
        }],
        "task_sessions": [{
            "id": 11,
            "task_id": 1,
            "date": today,
            "start_time": "09:00",
            "end_time": "10:00",
            "round": 1,
            "status": "planned",
            "planned_units": 3,
            "actual_units": 0,
            "self_rating": null,
            "self_note": null,
            "rescheduled_to": null,
            "xp_awarded": 0,
            "created_at": "2026-11-01 10:00:00"
        }],
        "actual_logs": [],
        "notes": [],
        "user_stats": {
            "total_xp": 100,
            "current_level": 1,
            "current_streak": 5,
            "longest_streak": 7,
            "last_done_date": null
        },
        "user_achievements": []
    })
}

/// 导入是数据快照，不修复 current_streak 与 last_done_date 的不一致。
/// 这种状态视为数据损坏，原样保留，由用户或后续显式修复操作处理。
#[tokio::test]
async fn import_positive_streak_with_null_last_done_does_not_reset_on_import() {
    let (path, conn) = open_rusqlite_migrated().await;
    let today = Local::now().format("%Y-%m-%d").to_string();
    let result = import_json_impl(&conn, &inconsistent_streak_payload(&today).to_string());

    assert!(
        result.is_ok(),
        "a. inconsistent streak must not be rejected: {result:?}"
    );
    let (current, longest, last) = streak_snapshot(&conn);
    assert_eq!(current, 5, "b. current_streak kept as imported");
    assert_eq!(longest, 7, "b. longest_streak kept as imported");
    assert!(
        last.is_none(),
        "b. last_done_date stays NULL, import does not invent an anchor: {last:?}"
    );

    let _ = std::fs::remove_file(&path);
}

/// 锁的是下一次完成时会发生什么，不是导入时应该修复。
/// `last_done_date` 为 NULL 时没有连续锚点，`update_streak_values` 把 current 写成 1；
/// longest 只和本次 next 取较大值，历史 7 必须留下。
#[tokio::test]
async fn import_positive_streak_with_null_last_done_resets_on_next_complete() {
    let (path, conn) = open_rusqlite_migrated().await;
    let today = Local::now().format("%Y-%m-%d").to_string();
    import_json_impl(&conn, &inconsistent_streak_payload(&today).to_string())
        .expect("import inconsistent streak");
    let (current, longest, last) = streak_snapshot(&conn);
    assert_eq!(current, 5, "precondition: imported current_streak");
    assert_eq!(longest, 7, "precondition: imported longest_streak");
    assert!(last.is_none(), "precondition: last_done_date is NULL");
    drop(conn);

    let path_str = path.to_string_lossy().replace('\\', "/");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&format!("sqlite:{path_str}?mode=rwc"))
        .await
        .expect("reopen pool for complete");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("pragma");

    let completed =
        complete_session_impl(&pool, 11, 3, Some(4), None, false, Local::now(), None).await;
    assert!(completed.is_ok(), "a. next complete must Ok: {completed:?}");

    let (current, longest, last): (i64, i64, Option<String>) = sqlx::query_as(
        "SELECT current_streak, longest_streak, last_done_date FROM user_stats WHERE id=1",
    )
    .fetch_one(&pool)
    .await
    .expect("streak after complete");
    assert_eq!(
        current, 1,
        "b. NULL last_done_date has no continuity anchor, current_streak resets to 1"
    );
    assert_eq!(
        longest, 7,
        "c. historical longest_streak must survive the reset"
    );
    assert_eq!(
        last.as_deref(),
        Some(today.as_str()),
        "d. last_done_date becomes the completed session date"
    );

    pool.close().await;
    let _ = std::fs::remove_file(&path);
}
