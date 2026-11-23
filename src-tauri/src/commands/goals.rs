//! 倒计时目标（高考 / 模考 / 里程碑……）。
//!
//! 目标以前只存在浏览器 localStorage 里，导出 JSON 导不出它。
//! 4.0 起落到 `goals` 表，导出导入才能带上目标。

use crate::db::{with_db, DbState};
use crate::models::{Goal, UpsertGoalPayload};
use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

/// 目标类型白名单：考试 / 里程碑 / 截止日。
pub const GOAL_KINDS: [&str; 3] = ["exam", "milestone", "deadline"];
/// 目标的默认类型。
pub const GOAL_KIND_EXAM: &str = "exam";

/// 导入旧备份（payload 里没有 goals 键）时补的默认目标。
pub const DEFAULT_GOAL_NAME: &str = "高考";
pub const DEFAULT_GOAL_DATE: &str = "2027-06-07";

const SELECT_GOAL: &str =
    "SELECT id, track_id, name, date, kind, is_primary, target_score, created_at FROM goals";

fn map_goal(row: &rusqlite::Row<'_>) -> rusqlite::Result<Goal> {
    Ok(Goal {
        id: row.get(0)?,
        track_id: row.get(1)?,
        name: row.get(2)?,
        date: row.get(3)?,
        kind: row.get(4)?,
        is_primary: row.get::<_, i64>(5)? != 0,
        target_score: row.get(6)?,
        created_at: row.get(7)?,
    })
}

/// 目标日期统一成 `YYYY-MM-DD`，顺手挡掉 `2026-1-1` 这种写法。
fn normalize_goal_date(raw: &str) -> Result<String, String> {
    let parts: Vec<&str> = raw.trim().split('-').collect();
    if parts.len() != 3 {
        return Err("目标日期格式应为 YYYY-MM-DD".to_string());
    }
    let Ok(year) = parts[0].parse::<i32>() else {
        return Err("目标日期格式应为 YYYY-MM-DD".to_string());
    };
    let Ok(month) = parts[1].parse::<u32>() else {
        return Err("目标日期格式应为 YYYY-MM-DD".to_string());
    };
    let Ok(day) = parts[2].parse::<u32>() else {
        return Err("目标日期格式应为 YYYY-MM-DD".to_string());
    };
    NaiveDate::from_ymd_opt(year, month, day)
        .map(|date| date.format("%Y-%m-%d").to_string())
        .ok_or_else(|| "目标日期无效".to_string())
}

/// 目标列表：主目标排最前，其余按日期从早到晚。
pub fn list_goals_impl(conn: &Connection) -> Result<Vec<Goal>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "{SELECT_GOAL} ORDER BY is_primary DESC, date ASC, id ASC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_goal)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 新建或修改一条目标。
///
/// `is_primary = true` 时，同一事务里把其它目标降为普通目标 —— 主目标永远只有一个。
pub fn upsert_goal_impl(
    conn: &Connection,
    payload: UpsertGoalPayload,
) -> Result<Goal, String> {
    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Err("请填写目标名称".to_string());
    }
    let date = normalize_goal_date(&payload.date)?;
    let kind = payload
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(GOAL_KIND_EXAM)
        .to_string();
    if !GOAL_KINDS.contains(&kind.as_str()) {
        return Err("目标类型不合法".to_string());
    }
    if payload.target_score.is_some_and(|value| value < 0.0) {
        return Err("目标分数不能为负数".to_string());
    }
    // 清空总分目标是显式动作：`target_score` 传 null 与「不传」同义，
    // 光靠它分不清「不改」和「清空」。
    let clear_target_score = payload.clear_target_score.unwrap_or(false);

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let id = match payload.id {
        Some(id) if id > 0 => {
            let exists: Option<i64> = tx
                .query_row("SELECT id FROM goals WHERE id = ?1", params![id], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(|e| e.to_string())?;
            if exists.is_none() {
                return Err("目标不存在".to_string());
            }
            // track_id / target_score 没传就保持原样，别把已有的赛道与总分目标抹掉。
            // 显式要清空总分目标时（clear_target_score）才写 NULL。
            tx.execute(
                r#"UPDATE goals
                      SET name = ?1,
                          date = ?2,
                          kind = ?3,
                          target_score = CASE WHEN ?4 = 1 THEN NULL ELSE COALESCE(?5, target_score) END,
                          track_id = COALESCE(?6, track_id)
                    WHERE id = ?7"#,
                params![
                    name,
                    date,
                    kind,
                    if clear_target_score { 1 } else { 0 },
                    payload.target_score,
                    payload.track_id,
                    id
                ],
            )
            .map_err(|e| e.to_string())?;
            id
        }
        _ => {
            let target_score: Option<f64> = if clear_target_score {
                None
            } else {
                payload.target_score
            };
            tx.execute(
                r#"INSERT INTO goals (track_id, name, date, kind, is_primary, target_score)
                   VALUES (?1, ?2, ?3, ?4, 0, ?5)"#,
                params![
                    payload.track_id,
                    name,
                    date,
                    kind,
                    target_score
                ],
            )
            .map_err(|e| e.to_string())?;
            tx.last_insert_rowid()
        }
    };

    if payload.is_primary.unwrap_or(false) {
        tx.execute(
            "UPDATE goals SET is_primary = CASE WHEN id = ?1 THEN 1 ELSE 0 END",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    }

    let goal = tx
        .query_row(&format!("{SELECT_GOAL} WHERE id = ?1"), params![id], map_goal)
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(goal)
}

/// 删除一条目标。删掉主目标后，剩下最早的那条自动顶上，避免一个目标都不剩。
pub fn remove_goal_impl(conn: &Connection, id: i64) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let changed = tx
        .execute("DELETE FROM goals WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("目标不存在".to_string());
    }
    let primaries: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM goals WHERE is_primary = 1",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if primaries == 0 {
        tx.execute(
            r#"UPDATE goals SET is_primary = 1
                WHERE id = (SELECT id FROM goals ORDER BY date ASC, id ASC LIMIT 1)"#,
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 把某条目标设为主目标，其它目标同时降级。
pub fn set_primary_goal_impl(conn: &Connection, id: i64) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let exists: Option<i64> = tx
        .query_row("SELECT id FROM goals WHERE id = ?1", params![id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if exists.is_none() {
        return Err("目标不存在".to_string());
    }
    tx.execute(
        "UPDATE goals SET is_primary = CASE WHEN id = ?1 THEN 1 ELSE 0 END",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 库里一条目标都没有时补一条默认目标（首次启动 / 导入旧备份用）。
///
/// 已经有目标就什么都不做：这是幂等操作，反复调用不会多出重复行。
/// 总分目标从旧档案搬过来，赛道跟着当前主赛道。
pub fn seed_default_goal_impl(conn: &Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM goals", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if count > 0 {
        return Ok(());
    }
    let track_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM tracks WHERE is_primary = 1 ORDER BY id ASC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    // 总分目标从旧档案搬过来；档案里没设就是「不设总分目标」。
    let target_score: Option<f64> = conn
        .query_row("SELECT total_target FROM user_profile WHERE id = 1", [], |r| {
            r.get::<_, Option<i64>>(0).map(|value| value.map(|v| v as f64))
        })
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    conn.execute(
        "INSERT INTO goals (track_id, name, date, kind, is_primary, target_score)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        params![
            track_id,
            DEFAULT_GOAL_NAME,
            DEFAULT_GOAL_DATE,
            GOAL_KIND_EXAM,
            target_score
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_goals(state: State<'_, DbState>) -> Result<Vec<Goal>, String> {
    with_db(&state, list_goals_impl)
}

#[tauri::command]
pub fn upsert_goal(
    state: State<'_, DbState>,
    payload: UpsertGoalPayload,
) -> Result<Goal, String> {
    with_db(&state, |conn| upsert_goal_impl(conn, payload))
}

#[tauri::command]
pub fn remove_goal(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| remove_goal_impl(conn, id))
}

#[tauri::command]
pub fn set_primary_goal(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| set_primary_goal_impl(conn, id))
}
