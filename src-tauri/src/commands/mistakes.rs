use crate::commands::app_settings::{
    get_list_setting_impl, TRACK_MISTAKE_REASONS_SETTING_KEY,
};
use crate::db::{with_db, DbState};
use crate::models::{CreateMistakePayload, Mistake, UpdateMistakePayload};
use rusqlite::{params, Connection};
use tauri::State;

/// 错因分类：内置默认的闭合集合，和前端 `src/lib/fallbacks.ts` 的
/// `FALLBACK_MISTAKE_REASONS` 一致。
///
/// 这只是**缺省值**：赛道包可以在 `app_settings` 里覆盖它
/// （key 见 `TRACK_MISTAKE_REASONS_SETTING_KEY`），前后端读同一份。
pub const REASON_WHITELIST: &[&str] = &[
    "概念不清",
    "公式记错",
    "审题失误",
    "计算失误",
    "方法不会",
    "粗心大意",
    "其他",
];

/// 当前生效的错因白名单。
///
/// 赛道包覆盖了就用覆盖的；没配置 / 配坏了（空表）就用内置的那份。
pub fn reason_whitelist(conn: &Connection) -> Vec<String> {
    let configured = get_list_setting_impl(conn, TRACK_MISTAKE_REASONS_SETTING_KEY);
    if configured.is_empty() {
        return REASON_WHITELIST
            .iter()
            .map(|reason| reason.to_string())
            .collect();
    }
    configured
}

/// 按给定的白名单归一错因：未知 / 空 → 「其他」。
///
/// 白名单里没有「其他」就退到第一项 —— 至少不是空的。
/// 前端 `normalizeReason` 是同一套算法。
pub fn normalize_reason_in(whitelist: &[String], raw: &str) -> String {
    let value = raw.trim();
    if let Some(found) = whitelist.iter().find(|reason| reason.as_str() == value) {
        return found.clone();
    }
    whitelist
        .iter()
        .find(|reason| reason.as_str() == "其他")
        .or_else(|| whitelist.first())
        .cloned()
        .unwrap_or_else(|| "其他".to_string())
}

/// 按当前生效的白名单归一错因。
pub fn normalize_reason_with(conn: &Connection, raw: &str) -> String {
    normalize_reason_in(&reason_whitelist(conn), raw)
}

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

/// 图谱考点 id：去空白，空的按「没挂知识点」处理。
fn normalize_graph_id(raw: Option<String>) -> Option<String> {
    raw.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// 图谱学科代号：去空白，空的按「没挂知识点」处理。
fn normalize_graph_subject(raw: Option<String>) -> Option<String> {
    raw.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// 知识点名字：去空白，空的按「没挂知识点」处理。
fn normalize_graph_name(raw: Option<String>) -> Option<String> {
    raw.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// 知识点挂载：三个字段各自归一，空的当「没挂」。
///
/// 知识点 id 是主角，它决定这条错题落在图谱的哪个点上；学科代号与名字只是
/// 跟着走的信息，用来拼出深链、显示标签。三个字段各自独立，不做「要么都有
/// 要么都没有」的强绑定，免得缺一个就把整条链接丢掉。
pub fn normalize_graph_link(
    topic_id: Option<String>,
    subject: Option<String>,
    name: Option<String>,
) -> (Option<String>, Option<String>, Option<String>) {
    (
        normalize_graph_id(topic_id),
        normalize_graph_subject(subject),
        normalize_graph_name(name),
    )
}

fn map_mistake(row: &rusqlite::Row<'_>) -> rusqlite::Result<Mistake> {
    Ok(Mistake {
        id: row.get(0)?,
        subject: row.get(1)?,
        title: row.get(2)?,
        reason: row.get(3)?,
        correct_note: row.get(4)?,
        is_mastered: row.get(5)?,
        graph_topic_id: row.get(8)?,
        graph_subject: row.get(9)?,
        graph_topic_name: row.get(10)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

const MISTAKE_COLUMNS: &str = "id, subject, title, reason, correct_note, is_mastered, created_at, updated_at, graph_topic_id, graph_subject, graph_topic_name";

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

/// 当前生效的错因白名单。前端下拉框用同一份。
#[tauri::command]
pub fn list_mistake_reasons(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    with_db(&state, |conn| Ok(reason_whitelist(conn)))
}

/// 新建一条错题。错因归一到白名单，科目去空白，题目简述不能是空的。
///
/// `graph_topic_id` / `graph_subject` 是可选的：挂上就说明这条错题落在哪个
/// 图谱知识点上，不挂也能记，图谱插件不是记错题的前置条件。
pub fn create_mistake_impl(
    conn: &Connection,
    payload: CreateMistakePayload,
) -> Result<Mistake, String> {
    let title = payload.title.trim().to_string();
    if title.is_empty() {
        return Err("题目简述不能为空".to_string());
    }
    let subject = normalize_subject(&payload.subject);
    let reason = normalize_reason_with(conn, &payload.reason);
    let (graph_topic_id, graph_subject, graph_topic_name) = normalize_graph_link(
        payload.graph_topic_id,
        payload.graph_subject,
        payload.graph_topic_name,
    );
    conn.execute(
        "INSERT INTO mistakes (subject, title, reason, correct_note, graph_topic_id, graph_subject, graph_topic_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            subject,
            title,
            reason,
            payload.correct_note,
            graph_topic_id,
            graph_subject,
            graph_topic_name
        ],
    )
    .map_err(|e| e.to_string())?;
    fetch_mistake(conn, conn.last_insert_rowid())
}

#[tauri::command]
pub fn create_mistake(
    state: State<'_, DbState>,
    payload: CreateMistakePayload,
) -> Result<Mistake, String> {
    with_db(&state, |conn| create_mistake_impl(conn, payload))
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
        mistake.reason = normalize_reason_with(conn, &r);
    }
    if let Some(c) = payload.correct_note {
        mistake.correct_note = c;
    }
    if let Some(m) = payload.is_mastered {
        mistake.is_mastered = if m != 0 { 1 } else { 0 };
    }
    // 知识点挂载：id 是锚。
    // - 给了新的 id：换绑是整组换。学科与名字没给就清掉——宁可少一个深链，
    //   也不能让新 id 挂着旧名字，那会把这条错题显示成另一个知识点。
    // - 给了空的 id：解绑，三个字段一起清，不留「没 id 却有名字」的孤儿。
    // - 没碰 id：只改明确给定的字段。
    match payload.graph_topic_id.as_ref() {
        Some(raw) if !raw.trim().is_empty() => {
            mistake.graph_topic_id = Some(raw.trim().to_string());
            mistake.graph_subject = normalize_graph_subject(payload.graph_subject.clone());
            mistake.graph_topic_name = normalize_graph_name(payload.graph_topic_name.clone());
        }
        Some(_) => {
            mistake.graph_topic_id = None;
            mistake.graph_subject = None;
            mistake.graph_topic_name = None;
        }
        None => {
            if payload.graph_subject.is_some() {
                mistake.graph_subject = normalize_graph_subject(payload.graph_subject.clone());
            }
            if payload.graph_topic_name.is_some() {
                mistake.graph_topic_name = normalize_graph_name(payload.graph_topic_name.clone());
            }
        }
    }
    conn.execute(
        "UPDATE mistakes
            SET subject=?1, title=?2, reason=?3, correct_note=?4, is_mastered=?5,
                graph_topic_id=?6, graph_subject=?7, graph_topic_name=?8,
                updated_at=datetime('now','localtime')
          WHERE id=?9",
        params![
            mistake.subject,
            mistake.title,
            mistake.reason,
            mistake.correct_note,
            mistake.is_mastered,
            mistake.graph_topic_id,
            mistake.graph_subject,
            mistake.graph_topic_name,
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
