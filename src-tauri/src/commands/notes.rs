use crate::db::{with_db, DbState};
use crate::models::{Note, UpdateNotePayload};
use rusqlite::{params, Connection};
use tauri::State;

/// Frontend `NOTE_COLORS` — closed set for sticky-note accents.
pub const COLOR_WHITELIST: &[&str] = &["yellow", "orange", "green", "blue", "pink", "purple"];

/// Map any string to a whitelist color; unknown → `"yellow"` (option B).
pub fn normalize_color(raw: &str) -> &'static str {
    COLOR_WHITELIST
        .iter()
        .copied()
        .find(|&c| c == raw)
        .unwrap_or("yellow")
}

fn map_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        content: row.get(1)?,
        color: row.get(2)?,
        pinned: row.get(3)?,
        note_date: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

const NOTE_COLUMNS: &str = "id, content, color, pinned, note_date, created_at, updated_at";

fn fetch_note(conn: &Connection, id: i64) -> Result<Note, String> {
    conn.query_row(
        &format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id=?1"),
        params![id],
        map_note,
    )
    .map_err(|e| e.to_string())
}

/// Pure list for tests and the command wrapper.
/// Sort: pinned first, then updated_at DESC, then id DESC so equal timestamps stay stable.
pub fn list_notes_impl(conn: &Connection) -> Result<Vec<Note>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {NOTE_COLUMNS} FROM notes
             ORDER BY pinned DESC, updated_at DESC, id DESC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_note)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn list_notes(state: State<'_, DbState>) -> Result<Vec<Note>, String> {
    with_db(&state, list_notes_impl)
}

/// Pure create for tests and the command wrapper. Color is normalized to whitelist.
pub fn create_note_impl(conn: &Connection, content: String, color: String) -> Result<Note, String> {
    create_note_with_date_impl(conn, content, color, None)
}

/// Pure create with an optional bound date (`YYYY-MM-DD`).
/// Empty / malformed values are stored as "no date" instead of being rejected.
pub fn create_note_with_date_impl(
    conn: &Connection,
    content: String,
    color: String,
    note_date: Option<String>,
) -> Result<Note, String> {
    let color = normalize_color(&color);
    let note_date = normalize_note_date(note_date.as_deref());
    conn.execute(
        "INSERT INTO notes (content, color, note_date) VALUES (?1, ?2, ?3)",
        params![content, color, note_date],
    )
    .map_err(|e| e.to_string())?;
    fetch_note(conn, conn.last_insert_rowid())
}

/// A bound date must look like `YYYY-MM-DD`; anything else is treated as "no date".
pub fn normalize_note_date(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    if value.is_empty() {
        return None;
    }
    if value.len() == 10
        && value.as_bytes()[4] == b'-'
        && value.as_bytes()[7] == b'-'
        && value
            .as_bytes()
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        Some(value.to_string())
    } else {
        None
    }
}

#[tauri::command]
pub fn create_note(
    state: State<'_, DbState>,
    content: String,
    color: String,
    note_date: Option<String>,
) -> Result<Note, String> {
    with_db(&state, |conn| {
        create_note_with_date_impl(conn, content, color, note_date)
    })
}

/// Pure update for tests and the command wrapper.
/// Always writes `updated_at=datetime('now','localtime')` (same clock as schema DEFAULTs).
/// Color (when provided) is normalized to whitelist.
pub fn update_note_impl(
    conn: &Connection,
    id: i64,
    payload: UpdateNotePayload,
) -> Result<Note, String> {
    let mut note = fetch_note(conn, id)?;
    if let Some(c) = payload.content {
        note.content = c;
    }
    if let Some(c) = payload.color {
        note.color = normalize_color(&c).to_string();
    }
    if let Some(p) = payload.pinned {
        note.pinned = if p { 1 } else { 0 };
    }
    if let Some(d) = payload.note_date.as_deref() {
        note.note_date = normalize_note_date(Some(d));
    }
    conn.execute(
        "UPDATE notes SET content=?1, color=?2, pinned=?3, note_date=?4, updated_at=datetime('now','localtime') WHERE id=?5",
        params![note.content, note.color, note.pinned, note.note_date, id],
    )
    .map_err(|e| e.to_string())?;
    fetch_note(conn, id)
}

#[tauri::command]
pub fn update_note(
    state: State<'_, DbState>,
    id: i64,
    payload: UpdateNotePayload,
) -> Result<Note, String> {
    with_db(&state, |conn| update_note_impl(conn, id, payload))
}

#[tauri::command]
pub fn delete_note(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        conn.execute("DELETE FROM notes WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}
