//! 科目字典。
//!
//! 4.0 之前成绩写死六科（语文/数学/英语/物理/化学/生物），换个赛道就装不下。
//! 科目集合挪进 `subjects` 表，前端的折算口径、成绩表单、设置页都从这里读。
//!
//! 科目挂在赛道下面（`track_id`），换赛道就是换一套科目。

use crate::db::{with_db, DbState};
use crate::models::{Subject, UpsertSubjectPayload};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

const SELECT_SUBJECT: &str =
    "SELECT id, key, label, full_mark, goal, unit, order_index, track_id FROM subjects";

fn map_subject(row: &rusqlite::Row<'_>) -> rusqlite::Result<Subject> {
    Ok(Subject {
        id: row.get(0)?,
        key: row.get(1)?,
        label: row.get(2)?,
        full_mark: row.get(3)?,
        goal: row.get(4)?,
        unit: row.get(5)?,
        order_index: row.get(6)?,
        track_id: row.get(7)?,
    })
}

/// 科目列表。给了赛道就只看这条赛道下的科目，没给就全库。
///
/// `track_id` 为 `None` 时不按赛道过滤 —— 设置页要看当前赛道的科目，
/// 迁移与导出则要看到全库。
pub fn list_subjects_impl(
    conn: &Connection,
    track_id: Option<i64>,
) -> Result<Vec<Subject>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "{SELECT_SUBJECT} WHERE (?1 IS NULL OR track_id = ?1) ORDER BY order_index ASC, id ASC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![track_id], map_subject)
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

/// 下一个排序序号。追加新科目时排在最后。
fn next_order_index(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(order_index), -1) + 1 FROM subjects",
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// 没给 key 时按显示名生成一个唯一 key。
///
/// 中文名没法转成有意义的拼音，就落到 `subject` / `subject_2` 这种中性 key；
/// 成绩行靠 key 找回科目，key 只需要稳定且唯一。
fn generate_subject_key(conn: &Connection, label: &str) -> Result<String, String> {
    let slug: String = label
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    let base = if slug.is_empty() { "subject" } else { slug.as_str() };
    let mut candidate = base.to_string();
    let mut suffix = 1;
    while subject_id_for_key(conn, &candidate)?.is_some() {
        suffix += 1;
        candidate = format!("{base}_{suffix}");
    }
    Ok(candidate)
}

/// key 全库唯一。`exclude_id` 是改已有科目时排除自己。
fn ensure_key_unique(
    conn: &Connection,
    key: &str,
    exclude_id: Option<i64>,
) -> Result<(), String> {
    let existing: Option<i64> = conn
        .query_row("SELECT id FROM subjects WHERE key = ?1", params![key], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    match (existing, exclude_id) {
        (None, _) => Ok(()),
        (Some(id), Some(exclude)) if id == exclude => Ok(()),
        (Some(_), _) => Err("科目标识已存在".to_string()),
    }
}

/// 新建或修改一科。
///
/// `id` 有值就是改这一科；没传 `id` 时就是新建，`key` 撞车会报错。
/// 想做幂等播种（先查再改）请自己先查一遍再带上 `id`。
pub fn upsert_subject_impl(
    conn: &Connection,
    payload: UpsertSubjectPayload,
) -> Result<Subject, String> {
    let label = payload.label.trim().to_string();
    if label.is_empty() {
        return Err("请填写科目名称".to_string());
    }
    if payload.full_mark.is_some_and(|value| value < 0.0) {
        return Err("科目满分不能为负数".to_string());
    }
    if payload.goal.is_some_and(|value| value < 0.0) {
        return Err("科目目标分不能为负数".to_string());
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let existing_id = match payload.id {
        Some(id) if id > 0 => {
            let exists: Option<i64> = tx
                .query_row("SELECT id FROM subjects WHERE id = ?1", params![id], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(|e| e.to_string())?;
            match exists {
                Some(id) => Some(id),
                None => return Err("科目不存在".to_string()),
            }
        }
        _ => None,
    };
    let key_input = payload
        .key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let id = match existing_id {
        Some(id) => {
            let existing_key: String = tx
                .query_row("SELECT key FROM subjects WHERE id = ?1", params![id], |r| {
                    r.get(0)
                })
                .map_err(|e| e.to_string())?;
            let key = key_input.unwrap_or(existing_key);
            ensure_key_unique(&tx, &key, Some(id))?;
            // track_id 没传就保持原样，别把已有的赛道抹掉。
            tx.execute(
                r#"UPDATE subjects
                      SET key = ?1,
                          label = ?2,
                          full_mark = ?3,
                          goal = ?4,
                          unit = ?5,
                          order_index = COALESCE(?6, order_index),
                          track_id = COALESCE(?7, track_id)
                    WHERE id = ?8"#,
                params![
                    key,
                    label,
                    payload.full_mark,
                    payload.goal,
                    payload.unit,
                    payload.order_index,
                    payload.track_id,
                    id
                ],
            )
            .map_err(|e| e.to_string())?;
            id
        }
        None => {
            let key = match key_input {
                Some(key) => key,
                None => generate_subject_key(&tx, &label)?,
            };
            // 没带 id 就是新建：key 撞车直接报错，别默默改掉已有那一科。
            // 幂等播种请用带 id 的 upsert（先查再改）。
            ensure_key_unique(&tx, &key, None)?;
            let order_index = match payload.order_index {
                Some(value) => value,
                None => next_order_index(&tx)?,
            };
            tx.execute(
                r#"INSERT INTO subjects (key, label, full_mark, goal, unit, order_index, track_id)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
                params![
                    key,
                    label,
                    payload.full_mark,
                    payload.goal,
                    payload.unit,
                    order_index,
                    payload.track_id
                ],
            )
            .map_err(|e| e.to_string())?;
            tx.last_insert_rowid()
        }
    };

    let subject = tx
        .query_row(
            &format!("{SELECT_SUBJECT} WHERE id = ?1"),
            params![id],
            map_subject,
        )
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(subject)
}

/// 删除一科。
///
/// 它的历史成绩行一起清掉：`exam_scores.subject_id` 指向科目，
/// 外键开着时留着会让成绩页算出不存在的科目。
///
/// 删掉的科目 key 会记进 `removed_subjects`：默认赛道的出厂科目每次启动
/// 都会重播一遍，不记一笔的话下次启动这科就带着满分目标回来了。
pub fn remove_subject_impl(conn: &Connection, id: i64) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let key: Option<String> = tx
        .query_row("SELECT key FROM subjects WHERE id = ?1", params![id], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(key) = key {
        tx.execute(
            "INSERT OR IGNORE INTO removed_subjects (key) VALUES (?1)",
            params![key],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute("DELETE FROM exam_scores WHERE subject_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    let changed = tx
        .execute("DELETE FROM subjects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("科目不存在".to_string());
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_subjects(
    state: State<'_, DbState>,
    track_id: Option<i64>,
) -> Result<Vec<Subject>, String> {
    with_db(&state, |conn| list_subjects_impl(conn, track_id))
}

#[tauri::command]
pub fn upsert_subject(
    state: State<'_, DbState>,
    payload: UpsertSubjectPayload,
) -> Result<Subject, String> {
    with_db(&state, |conn| upsert_subject_impl(conn, payload))
}

#[tauri::command]
pub fn remove_subject(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| remove_subject_impl(conn, id))
}
