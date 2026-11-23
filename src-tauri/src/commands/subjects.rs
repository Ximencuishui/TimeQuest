//! 科目字典。
//!
//! 4.0 之前成绩写死六科（语文/数学/英语/物理/化学/生物），换个赛道就装不下。
//! 科目集合挪进 `subjects` 表，前端的折算口径、成绩表单都从这里读。
//!
//! P1-1 只落地字典本身：建表、种子数据、只读查询。
//! 赛道归属（`track_id`）与科目的增删改在 P1-2 补上。

use crate::db::{with_db, DbState};
use crate::models::Subject;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

const SELECT_SUBJECT: &str = "SELECT id, key, label, full_mark, goal, unit, order_index FROM subjects";

fn map_subject(row: &rusqlite::Row<'_>) -> rusqlite::Result<Subject> {
    Ok(Subject {
        id: row.get(0)?,
        key: row.get(1)?,
        label: row.get(2)?,
        full_mark: row.get(3)?,
        goal: row.get(4)?,
        unit: row.get(5)?,
        order_index: row.get(6)?,
    })
}

/// 科目列表，按展示顺序排。
pub fn list_subjects_impl(conn: &Connection) -> Result<Vec<Subject>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "{SELECT_SUBJECT} ORDER BY order_index ASC, id ASC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_subject)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 按 key 找科目 id。找不到就是 `None`（不报错，调用方自己决定怎么办）。
pub fn subject_id_for_key(conn: &Connection, key: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM subjects WHERE key = ?1",
        params![key],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// 科目的显示名，用来拼错误提示。
pub fn subject_label(conn: &Connection, id: i64) -> Result<Option<String>, String> {
    conn.query_row("SELECT label FROM subjects WHERE id = ?1", params![id], |r| {
        r.get(0)
    })
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_subjects(state: State<'_, DbState>) -> Result<Vec<Subject>, String> {
    with_db(&state, list_subjects_impl)
}