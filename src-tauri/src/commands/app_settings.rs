use crate::db::{with_db, DbState};
use rusqlite::{params, Connection};
use tauri::State;

/// Read one setting. Missing keys are `Ok(None)`, not an error.
pub fn get_setting_impl(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    match conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    ) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Insert or replace. Repeated writes of the same key stay one row.
pub fn set_setting_impl(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        r#"INSERT INTO app_settings (key, value, updated_at)
           VALUES (?1, ?2, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = excluded.updated_at"#,
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_setting(state: State<'_, DbState>, key: String) -> Result<Option<String>, String> {
    with_db(&state, |conn| get_setting_impl(conn, &key))
}

#[tauri::command]
pub fn set_setting(state: State<'_, DbState>, key: String, value: String) -> Result<(), String> {
    with_db(&state, |conn| set_setting_impl(conn, &key, &value))
}
