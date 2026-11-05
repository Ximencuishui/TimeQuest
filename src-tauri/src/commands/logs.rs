use crate::db::{with_db, DbState};
use crate::models::{ActualLog, CreateLogPayload};
use chrono::{DateTime, NaiveDateTime};
use rusqlite::{params, Connection};
use tauri::State;

fn map_log(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActualLog> {
    Ok(ActualLog {
        id: row.get(0)?,
        date: row.get(1)?,
        start_at: row.get(2)?,
        end_at: row.get(3)?,
        duration_min: row.get(4)?,
        subject: row.get(5)?,
        method: row.get(6)?,
        tag_type: row.get(7)?,
        session_id: row.get(8)?,
        note: row.get(9)?,
        created_at: row.get(10)?,
    })
}

/// Manual-log duration: prefer explicit `duration_min` (clamped ≥ 0); else end−start in
/// minutes (also ≥ 0). Unlike completion, zero is allowed — no `.max(1)`.
pub fn compute_duration_min(
    start_at: &Option<String>,
    end_at: &Option<String>,
    fallback: Option<i64>,
) -> i64 {
    if let Some(d) = fallback {
        return d.max(0);
    }
    let parse = |s: &str| -> Option<i64> {
        if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
            return Some(dt.timestamp());
        }
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
            return Some(dt.and_utc().timestamp());
        }
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
            return Some(dt.and_utc().timestamp());
        }
        None
    };
    match (
        start_at.as_deref().and_then(parse),
        end_at.as_deref().and_then(parse),
    ) {
        (Some(a), Some(b)) if b >= a => ((b - a) / 60).max(0),
        _ => 0,
    }
}

/// Pure (no Tauri) manual log insert for tests and the command wrapper.
pub fn create_log_impl(
    conn: &Connection,
    payload: CreateLogPayload,
) -> Result<ActualLog, String> {
    let duration = compute_duration_min(&payload.start_at, &payload.end_at, payload.duration_min);
    let tag_type = payload.tag_type.unwrap_or_else(|| "study".into());
    conn.execute(
        r#"INSERT INTO actual_logs (date, start_at, end_at, duration_min, subject, method, tag_type, note)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
        params![
            payload.date,
            payload.start_at,
            payload.end_at,
            duration,
            payload.subject,
            payload.method,
            tag_type,
            payload.note
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, date, start_at, end_at, duration_min, subject, method, tag_type, session_id, note, created_at FROM actual_logs WHERE id=?1",
        params![id],
        map_log,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_log(
    state: State<'_, DbState>,
    payload: CreateLogPayload,
) -> Result<ActualLog, String> {
    with_db(&state, |conn| create_log_impl(conn, payload))
}

#[tauri::command]
pub fn list_logs(
    state: State<'_, DbState>,
    from: String,
    to: String,
) -> Result<Vec<ActualLog>, String> {
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, date, start_at, end_at, duration_min, subject, method, tag_type, session_id, note, created_at
                 FROM actual_logs WHERE date >= ?1 AND date <= ?2 ORDER BY date DESC, id DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![from, to], map_log)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}
