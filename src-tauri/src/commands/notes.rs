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
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn fetch_note(conn: &Connection, id: i64) -> Result<Note, String> {
    conn.query_row(
        "SELECT id, content, color, pinned, created_at, updated_at FROM notes WHERE id=?1",
        params![id],
        map_note,
    )
    .map_err(|e| e.to_string())
}

/// Pure list for tests and the command wrapper.
/// Sort: pinned first, then updated_at DESC, then id DESC so equal timestamps stay stable.
pub fn list_notes_impl(conn: &Connection) -> Result<Vec<Note>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, content, color, pinned, created_at, updated_at FROM notes
             ORDER BY pinned DESC, updated_at DESC, id DESC",
        )
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
    let color = normalize_color(&color);
    conn.execute(
        "INSERT INTO notes (content, color) VALUES (?1, ?2)",
        params![content, color],
    )
    .map_err(|e| e.to_string())?;
    fetch_note(conn, conn.last_insert_rowid())
}

#[tauri::command]
pub fn create_note(
    state: State<'_, DbState>,
    content: String,
    color: String,
) -> Result<Note, String> {
    with_db(&state, |conn| create_note_impl(conn, content, color))
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
    conn.execute(
        "UPDATE notes SET content=?1, color=?2, pinned=?3, updated_at=datetime('now','localtime') WHERE id=?4",
        params![note.content, note.color, note.pinned, id],
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
