use crate::db::{with_db, DbState};
use rusqlite::{params, Connection};
use tauri::State;

/// 赛道级学习方式在 `app_settings` 里的 key。
///
/// 赛道包可以带一份自己的学习方式；装上就写进这个 key，前端读它。
pub const TRACK_METHODS_SETTING_KEY: &str = "track.methods";

/// 赛道级错因白名单在 `app_settings` 里的 key。
///
/// 前后端读的是同一份：前端下拉框用它，后端归一错因也用它。
pub const TRACK_MISTAKE_REASONS_SETTING_KEY: &str = "track.mistake_reasons";

/// 清洗一份列表配置：去空白、去空项、去重。顺序保持原样。
pub fn clean_list_setting(values: &[String]) -> Vec<String> {
    let mut list: Vec<String> = Vec::new();
    for value in values {
        let value = value.trim().to_string();
        if value.is_empty() || list.contains(&value) {
            continue;
        }
        list.push(value);
    }
    list
}

/// 读一条列表配置：值是一份 JSON 数组。
///
/// 没这一行 / 不是 JSON / 不是数组 / 全是空白 → 空列表，由调用方决定兜底。
pub fn get_list_setting_impl(conn: &Connection, key: &str) -> Vec<String> {
    let raw = match conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    ) {
        Ok(value) => value,
        // 没这一行 / 读不出来：当作没配置。
        Err(_) => return Vec::new(),
    };
    let Ok(values) = serde_json::from_str::<Vec<String>>(&raw) else {
        return Vec::new();
    };
    clean_list_setting(&values)
}

/// 写一条列表配置：存成一份 JSON 数组。
pub fn set_list_setting_impl(
    conn: &Connection,
    key: &str,
    values: &[String],
) -> Result<(), String> {
    let list = clean_list_setting(values);
    let value = serde_json::to_string(&list).map_err(|err| err.to_string())?;
    set_setting_impl(conn, key, &value)
}

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
