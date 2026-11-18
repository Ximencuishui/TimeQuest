use crate::db::{with_db, DbState};
use crate::models::{Mistake, UpdateMistakePayload};
use rusqlite::{params, Connection};
use tauri::State;

/// 错因分类：闭合集合，和前端 `src/lib/mistakes.ts` 的 `MISTAKE_REASONS` 一致。
pub const REASON_WHITELIST: &[&str] = &[
    "概念不清",
    "公式记错",
    "审题失误",
    "计算失误",
    "方法不会",
    "粗心大意",
    "其他",
];

/// 把任意错因映射到白名单；未知 / 空 → `"其他"`。
pub fn normalize_reason(raw: &str) -> &'static str {
    let value = raw.trim();
    REASON_WHITELIST
        .iter()
        .copied()
        .find(|&r| r == value)
        .unwrap_or("其他")
}

/// 科目是开放字符串：只去空白，空的归到 `"其他"`。
pub fn normalize_subject(raw: &str) -> String {
    let value = raw.trim();
    if value.is_empty() {
        "其他".to_string()
    } else {
        value.to_string()
    }
}

fn map_mistake(row: &rusqlite::Row<'_>) -> rusqlite::Result<Mistake> {
    Ok(Mistake {
        id: row.get(0)?,
        subject: row.get(1)?,
        title: row.get(2)?,
        reason: row.get(3)?,
        correct_note: row.get(4)?,
        is_mastered: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

const MISTAKE_COLUMNS: &str =
    "id, subject, title, reason, correct_note, is_mastered, created_at, updated_at";

fn fetch_mistake(conn: &Connection, id: i64) -> Result<Mistake, String> {
    conn.query_row(
        &format!("SELECT {MISTAKE_COLUMNS} FROM mistakes WHERE id=?1"),
        params![id],
        map_mistake,
    )
    .map_err(|e| e.to_string())
}

/// 未订正的排前面；同组按创建时间倒序，最后按 id 倒序保证顺序稳定。
pub fn list_mistakes_impl(conn: &Connection) -> Result<Vec<Mistake>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {MISTAKE_COLUMNS} FROM mistakes
             ORDER BY is_mastered ASC, created_at DESC, id DESC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_mistake)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn list_mistakes(state: State<'_, DbState>) -> Result<Vec<Mistake>, String> {
    with_db(&state, list_mistakes_impl)
}

/// 新建一条错题。错因归一到白名单，科目去空白。
pub fn create_mistake_impl(
    conn: &Connection,
    subject: String,
    title: String,
    reason: String,
    correct_note: String,
) -> Result<Mistake, String> {
    let subject = normalize_subject(&subject);
    let reason = normalize_reason(&reason).to_string();
    conn.execute(
        "INSERT INTO mistakes (subject, title, reason, correct_note) VALUES (?1, ?2, ?3, ?4)",
        params![subject, title, reason, correct_note],
    )
    .map_err(|e| e.to_string())?;
    fetch_mistake(conn, conn.last_insert_rowid())
}

#[tauri::command]
pub fn create_mistake(
    state: State<'_, DbState>,
    subject: String,
    title: String,
    reason: String,
    correct_note: String,
) -> Result<Mistake, String> {
    with_db(&state, |conn| {
        create_mistake_impl(conn, subject, title, reason, correct_note)
    })
}

/// 更新一条错题；`None` 的字段保持原样。
pub fn update_mistake_impl(
    conn: &Connection,
    id: i64,
    payload: UpdateMistakePayload,
) -> Result<Mistake, String> {
    let mut mistake = fetch_mistake(conn, id)?;
    if let Some(s) = payload.subject {
        mistake.subject = normalize_subject(&s);
    }
    if let Some(t) = payload.title {
        mistake.title = t;
    }
    if let Some(r) = payload.reason {
        mistake.reason = normalize_reason(&r).to_string();
    }
    if let Some(c) = payload.correct_note {
        mistake.correct_note = c;
    }
    if let Some(m) = payload.is_mastered {
        mistake.is_mastered = if m != 0 { 1 } else { 0 };
    }
    conn.execute(
        "UPDATE mistakes
            SET subject=?1, title=?2, reason=?3, correct_note=?4, is_mastered=?5,
                updated_at=datetime('now','localtime')
          WHERE id=?6",
        params![
            mistake.subject,
            mistake.title,
            mistake.reason,
            mistake.correct_note,
            mistake.is_mastered,
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    fetch_mistake(conn, id)
}

#[tauri::command]
pub fn update_mistake(
    state: State<'_, DbState>,
    id: i64,
    payload: UpdateMistakePayload,
) -> Result<Mistake, String> {
    with_db(&state, |conn| update_mistake_impl(conn, id, payload))
}

/// 删除一条错题。行不存在也算成功（幂等）。
pub fn delete_mistake_impl(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM mistakes WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_mistake(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| delete_mistake_impl(conn, id))
}
