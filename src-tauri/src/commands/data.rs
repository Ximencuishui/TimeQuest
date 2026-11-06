use crate::commands::notes::normalize_color;
use crate::db::{db_path, with_db, DbState};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use tauri::{AppHandle, State};

use crate::db::AppPrefs;

/// Reject `actual_logs.session_id` that is non-null but missing from payload `task_sessions`.
/// `session_id: null` (manual log) is allowed. Runs before any write so the Err names the log.
fn validate_actual_log_session_refs(data: &Value) -> Result<(), String> {
    let session_ids: HashSet<i64> = data
        .get("task_sessions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.get("id").and_then(|v| v.as_i64()))
                .collect()
        })
        .unwrap_or_default();

    if let Some(arr) = data.get("actual_logs").and_then(|v| v.as_array()) {
        for l in arr {
            let Some(sid) = l.get("session_id").and_then(|v| v.as_i64()) else {
                continue; // null / missing → manual log
            };
            if !session_ids.contains(&sid) {
                let log_id = l
                    .get("id")
                    .and_then(|v| v.as_i64())
                    .map(|id| id.to_string())
                    .unwrap_or_else(|| "?".into());
                return Err(format!(
                    "actual_logs id={log_id} has dangling session_id={sid} (not in task_sessions)"
                ));
            }
        }
    }
    Ok(())
}

/// Reject `user_achievements.achievement_id` missing from catalog table `achievements`.
/// Needed because import uses `INSERT OR IGNORE`, which would also swallow FK violations.
fn validate_user_achievement_refs(conn: &Connection, data: &Value) -> Result<(), String> {
    let known: HashSet<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM achievements")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<HashSet<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    if let Some(arr) = data.get("user_achievements").and_then(|v| v.as_array()) {
        for a in arr {
            let id = a
                .get("achievement_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !known.contains(id) {
                return Err(format!(
                    "user_achievements has dangling achievement_id={id:?} (not in achievements)"
                ));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_db_path(app: AppHandle) -> Result<String, String> {
    Ok(db_path(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_close_to_tray(prefs: State<'_, AppPrefs>, enabled: bool) -> Result<(), String> {
    prefs.set_close_to_tray(enabled);
    Ok(())
}

/// Export all user tables to a pretty JSON string. Pure (no Tauri) for tests.
pub fn export_json_impl(conn: &Connection) -> Result<String, String> {
    let tasks: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT id, title, type, subject, textbook, unit_name, total_units, total_rounds, current_round, color, archived, created_at FROM tasks")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "title": r.get::<_, String>(1)?,
                    "type": r.get::<_, String>(2)?,
                    "subject": r.get::<_, Option<String>>(3)?,
                    "textbook": r.get::<_, Option<String>>(4)?,
                    "unit_name": r.get::<_, String>(5)?,
                    "total_units": r.get::<_, Option<i64>>(6)?,
                    "total_rounds": r.get::<_, i64>(7)?,
                    "current_round": r.get::<_, i64>(8)?,
                    "color": r.get::<_, Option<String>>(9)?,
                    "archived": r.get::<_, i64>(10)?,
                    "created_at": r.get::<_, String>(11)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let sessions: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT id, task_id, date, start_time, end_time, round, status, planned_units, actual_units, self_rating, self_note, rescheduled_to, xp_awarded, created_at FROM task_sessions")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "task_id": r.get::<_, i64>(1)?,
                    "date": r.get::<_, String>(2)?,
                    "start_time": r.get::<_, String>(3)?,
                    "end_time": r.get::<_, String>(4)?,
                    "round": r.get::<_, i64>(5)?,
                    "status": r.get::<_, String>(6)?,
                    "planned_units": r.get::<_, i64>(7)?,
                    "actual_units": r.get::<_, i64>(8)?,
                    "self_rating": r.get::<_, Option<i64>>(9)?,
                    "self_note": r.get::<_, Option<String>>(10)?,
                    "rescheduled_to": r.get::<_, Option<i64>>(11)?,
                    "xp_awarded": r.get::<_, i64>(12)?,
                    "created_at": r.get::<_, String>(13)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let logs: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT id, date, start_at, end_at, duration_min, subject, method, tag_type, session_id, note, created_at FROM actual_logs")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "date": r.get::<_, String>(1)?,
                    "start_at": r.get::<_, Option<String>>(2)?,
                    "end_at": r.get::<_, Option<String>>(3)?,
                    "duration_min": r.get::<_, i64>(4)?,
                    "subject": r.get::<_, Option<String>>(5)?,
                    "method": r.get::<_, Option<String>>(6)?,
                    "tag_type": r.get::<_, String>(7)?,
                    "session_id": r.get::<_, Option<i64>>(8)?,
                    "note": r.get::<_, Option<String>>(9)?,
                    "created_at": r.get::<_, String>(10)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let notes: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT id, content, color, pinned, created_at, updated_at FROM notes")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "content": r.get::<_, String>(1)?,
                    "color": r.get::<_, String>(2)?,
                    "pinned": r.get::<_, i64>(3)?,
                    "created_at": r.get::<_, String>(4)?,
                    "updated_at": r.get::<_, String>(5)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    // Singleton: missing id=1 means corruption — fail loud, never omit user_stats.
    let stats: Value = conn
        .query_row(
            "SELECT total_xp, current_level, current_streak, longest_streak, last_done_date FROM user_stats WHERE id=1",
            [],
            |r| {
                Ok(json!({
                    "total_xp": r.get::<_, i64>(0)?,
                    "current_level": r.get::<_, i64>(1)?,
                    "current_streak": r.get::<_, i64>(2)?,
                    "longest_streak": r.get::<_, i64>(3)?,
                    "last_done_date": r.get::<_, Option<String>>(4)?,
                }))
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                "user_stats 缺失，数据损坏（需要 id=1 单例行）".to_string()
            }
            other => other.to_string(),
        })?;

    let achievements: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT achievement_id, unlocked_at FROM user_achievements")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "achievement_id": r.get::<_, String>(0)?,
                    "unlocked_at": r.get::<_, String>(1)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let app_settings: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT key, value, updated_at FROM app_settings ORDER BY key")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "key": r.get::<_, String>(0)?,
                    "value": r.get::<_, String>(1)?,
                    "updated_at": r.get::<_, String>(2)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let imported_textbooks: Vec<Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, subject, version, volume, outline_json, created_at, updated_at
                 FROM imported_textbooks ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "subject": r.get::<_, String>(1)?,
                    "version": r.get::<_, String>(2)?,
                    "volume": r.get::<_, String>(3)?,
                    "outline_json": r.get::<_, String>(4)?,
                    "created_at": r.get::<_, String>(5)?,
                    "updated_at": r.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let payload = json!({
        "version": 1,
        "exported_at": chrono::Local::now().to_rfc3339(),
        "tasks": tasks,
        "task_sessions": sessions,
        "actual_logs": logs,
        "notes": notes,
        "user_stats": stats,
        "user_achievements": achievements,
        "app_settings": app_settings,
        "imported_textbooks": imported_textbooks,
    });
    serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())
}

/// Import payload into `conn` inside a single transaction (clears user tables first).
/// Pure (no Tauri / no file backup) for tests.
pub fn import_json_impl(conn: &Connection, json: &str) -> Result<(), String> {
    let data: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    // Prefer A: reject dangling session_id before clearing / inserting (clearer Err than FK).
    validate_actual_log_session_refs(&data)?;
    // INSERT OR IGNORE would swallow FK misses on achievement_id; reject up front like logs.
    validate_user_achievement_refs(conn, &data)?;

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute_batch(
        r#"
            DELETE FROM user_achievements;
            DELETE FROM actual_logs;
            DELETE FROM task_sessions;
            DELETE FROM notes;
            DELETE FROM tasks;
            DELETE FROM app_settings;
            DELETE FROM imported_textbooks;
            UPDATE user_stats SET total_xp=0, current_level=1, current_streak=0, longest_streak=0, last_done_date=NULL WHERE id=1;
            "#,
    )
    .map_err(|e| e.to_string())?;

    if let Some(arr) = data.get("tasks").and_then(|v| v.as_array()) {
        for t in arr {
            tx.execute(
                r#"INSERT INTO tasks (id, title, type, subject, textbook, unit_name, total_units, total_rounds, current_round, color, archived, created_at)
                       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,COALESCE(?12, datetime('now','localtime')))"#,
                params![
                    t.get("id").and_then(|v| v.as_i64()),
                    t.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                    t.get("type").and_then(|v| v.as_str()).unwrap_or("side"),
                    t.get("subject").and_then(|v| v.as_str()),
                    t.get("textbook").and_then(|v| v.as_str()),
                    t.get("unit_name").and_then(|v| v.as_str()).unwrap_or("课"),
                    t.get("total_units").and_then(|v| v.as_i64()),
                    t.get("total_rounds").and_then(|v| v.as_i64()).unwrap_or(1),
                    t.get("current_round").and_then(|v| v.as_i64()).unwrap_or(1),
                    t.get("color").and_then(|v| v.as_str()),
                    t.get("archived").and_then(|v| v.as_i64()).unwrap_or(0),
                    t.get("created_at").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // Phase 1: insert sessions with rescheduled_to = NULL so self-FK never points
    // at a row that is not yet present (export order is not topological).
    if let Some(arr) = data.get("task_sessions").and_then(|v| v.as_array()) {
        for s in arr {
            tx.execute(
                r#"INSERT INTO task_sessions (id, task_id, date, start_time, end_time, round, status, planned_units, actual_units, self_rating, self_note, rescheduled_to, xp_awarded, created_at)
                       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,NULL,?12,COALESCE(?13, datetime('now','localtime')))"#,
                params![
                    s.get("id").and_then(|v| v.as_i64()),
                    s.get("task_id").and_then(|v| v.as_i64()).unwrap_or(0),
                    s.get("date").and_then(|v| v.as_str()).unwrap_or(""),
                    s.get("start_time").and_then(|v| v.as_str()).unwrap_or("09:00"),
                    s.get("end_time").and_then(|v| v.as_str()).unwrap_or("10:00"),
                    s.get("round").and_then(|v| v.as_i64()).unwrap_or(1),
                    s.get("status").and_then(|v| v.as_str()).unwrap_or("planned"),
                    s.get("planned_units").and_then(|v| v.as_i64()).unwrap_or(0),
                    s.get("actual_units").and_then(|v| v.as_i64()).unwrap_or(0),
                    s.get("self_rating").and_then(|v| v.as_i64()),
                    s.get("self_note").and_then(|v| v.as_str()),
                    s.get("xp_awarded").and_then(|v| v.as_i64()).unwrap_or(0),
                    s.get("created_at").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        // Phase 2: apply rescheduled_to after all session rows exist.
        for s in arr {
            let Some(id) = s.get("id").and_then(|v| v.as_i64()) else {
                continue;
            };
            let target = s.get("rescheduled_to").and_then(|v| v.as_i64());
            if target.is_some() {
                tx.execute(
                    "UPDATE task_sessions SET rescheduled_to = ?1 WHERE id = ?2",
                    params![target, id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    if let Some(arr) = data.get("actual_logs").and_then(|v| v.as_array()) {
        for l in arr {
            tx.execute(
                r#"INSERT INTO actual_logs (id, date, start_at, end_at, duration_min, subject, method, tag_type, session_id, note, created_at)
                       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,COALESCE(?11, datetime('now','localtime')))"#,
                params![
                    l.get("id").and_then(|v| v.as_i64()),
                    l.get("date").and_then(|v| v.as_str()).unwrap_or(""),
                    l.get("start_at").and_then(|v| v.as_str()),
                    l.get("end_at").and_then(|v| v.as_str()),
                    l.get("duration_min").and_then(|v| v.as_i64()).unwrap_or(0),
                    l.get("subject").and_then(|v| v.as_str()),
                    l.get("method").and_then(|v| v.as_str()),
                    l.get("tag_type").and_then(|v| v.as_str()).unwrap_or("study"),
                    l.get("session_id").and_then(|v| v.as_i64()),
                    l.get("note").and_then(|v| v.as_str()),
                    l.get("created_at").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if let Some(arr) = data.get("notes").and_then(|v| v.as_array()) {
        for n in arr {
            tx.execute(
                r#"INSERT INTO notes (id, content, color, pinned, created_at, updated_at)
                       VALUES (?1,?2,?3,?4,COALESCE(?5, datetime('now','localtime')), COALESCE(?6, datetime('now','localtime')))"#,
                params![
                    n.get("id").and_then(|v| v.as_i64()),
                    n.get("content").and_then(|v| v.as_str()).unwrap_or(""),
                    normalize_color(n.get("color").and_then(|v| v.as_str()).unwrap_or("yellow")),
                    n.get("pinned").and_then(|v| v.as_i64()).unwrap_or(0),
                    n.get("created_at").and_then(|v| v.as_str()),
                    n.get("updated_at").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if let Some(s) = data.get("user_stats") {
        // Singleton row only: reject explicit id ≠ 1 (CHECK(id=1) would also fire on bad INSERT).
        // Missing id (export format) is treated as 1.
        if let Some(id) = s.get("id").and_then(|v| v.as_i64()) {
            if id != 1 {
                return Err(format!("user_stats.id must be 1 (singleton), got {id}"));
            }
        }
        // UPSERT: plain UPDATE is a silent no-op when id=1 is missing.
        tx.execute(
            r#"INSERT INTO user_stats (id, total_xp, current_level, current_streak, longest_streak, last_done_date)
               VALUES (1, ?1, ?2, ?3, ?4, ?5)
               ON CONFLICT(id) DO UPDATE SET
                 total_xp = excluded.total_xp,
                 current_level = excluded.current_level,
                 current_streak = excluded.current_streak,
                 longest_streak = excluded.longest_streak,
                 last_done_date = excluded.last_done_date"#,
            params![
                s.get("total_xp").and_then(|v| v.as_i64()).unwrap_or(0),
                s.get("current_level").and_then(|v| v.as_i64()).unwrap_or(1),
                s.get("current_streak").and_then(|v| v.as_i64()).unwrap_or(0),
                s.get("longest_streak").and_then(|v| v.as_i64()).unwrap_or(0),
                s.get("last_done_date").and_then(|v| v.as_str()),
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    if let Some(arr) = data.get("user_achievements").and_then(|v| v.as_array()) {
        for a in arr {
            tx.execute(
                "INSERT OR IGNORE INTO user_achievements (achievement_id, unlocked_at) VALUES (?1, COALESCE(?2, datetime('now','localtime')))",
                params![
                    a.get("achievement_id").and_then(|v| v.as_str()).unwrap_or(""),
                    a.get("unlocked_at").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if let Some(arr) = data.get("imported_textbooks").and_then(|v| v.as_array()) {
        for row in arr {
            tx.execute(
                r#"INSERT INTO imported_textbooks (id, subject, version, volume, outline_json, created_at, updated_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, datetime('now','localtime')), COALESCE(?7, datetime('now','localtime')))"#,
                params![
                    row.get("id").and_then(|v| v.as_i64()),
                    row.get("subject").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("version").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("volume").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("outline_json").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("created_at").and_then(|v| v.as_str()),
                    row.get("updated_at").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if let Some(arr) = data.get("app_settings").and_then(|v| v.as_array()) {
        for row in arr {
            tx.execute(
                r#"INSERT INTO app_settings (key, value, updated_at)
                   VALUES (?1, ?2, COALESCE(?3, datetime('now')))"#,
                params![
                    row.get("key").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("value").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("updated_at").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // B 兜底：其它 FK（如 rescheduled_to）仍可能漏网；有违规则不 commit。
    {
        let mut stmt = tx
            .prepare("PRAGMA foreign_key_check")
            .map_err(|e| e.to_string())?;
        let violations: Vec<(String, i64, String, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if !violations.is_empty() {
            return Err(format!("import foreign_key_check failed: {violations:?}"));
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_json(state: State<'_, DbState>) -> Result<String, String> {
    with_db(&state, export_json_impl)
}

#[tauri::command]
pub fn import_json(app: AppHandle, state: State<'_, DbState>, json: String) -> Result<(), String> {
    let path = db_path(&app)?;
    // backup current db file
    let backup = path.with_extension(format!(
        "bak-{}.db",
        chrono::Local::now().format("%Y%m%d%H%M%S")
    ));
    if path.exists() {
        fs::copy(&path, &backup).map_err(|e| e.to_string())?;
    }

    with_db(&state, |conn| import_json_impl(conn, &json))
}
