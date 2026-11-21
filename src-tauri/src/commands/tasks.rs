use crate::db::{with_db, DbState};
use crate::error::SessionError;
use crate::models::{CreateTaskPayload, Task, TaskProgress, UpdateTaskPayload};
use rusqlite::params;
use sqlx::SqlitePool;
use tauri::State;

fn map_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        task_type: row.get(2)?,
        subject: row.get(3)?,
        textbook: row.get(4)?,
        unit_name: row.get(5)?,
        total_units: row.get(6)?,
        total_rounds: row.get(7)?,
        current_round: row.get(8)?,
        color: row.get(9)?,
        archived: row.get(10)?,
        created_at: row.get(11)?,
        deleted_at: row.get(12)?,
        actual_units_sum: row.get(13).ok(),
    })
}

/// 单个任务。回收站里的任务（`deleted_at` 非空）当作不存在。
pub fn fetch_task_impl(conn: &rusqlite::Connection, id: i64) -> Result<Task, String> {
    conn.query_row(
        r#"SELECT t.id, t.title, t.type, t.subject, t.textbook, t.unit_name,
                  t.total_units, t.total_rounds, t.current_round, t.color,
                  t.archived, t.created_at, t.deleted_at,
                  (SELECT COALESCE(SUM(s.actual_units),0) FROM task_sessions s
                   WHERE s.task_id = t.id AND s.status = 'done' AND s.round = t.current_round)
           FROM tasks t WHERE t.id = ?1 AND t.deleted_at IS NULL"#,
        params![id],
        map_task,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            format!("任务 {id} 不存在或已在回收站里")
        }
        other => other.to_string(),
    })
}

/// 计划里的任务。回收站里的任务（`deleted_at` 非空）一律不返回。
pub fn list_tasks_impl(
    conn: &rusqlite::Connection,
    include_archived: bool,
) -> Result<Vec<Task>, String> {
    let sql = if include_archived {
        r#"SELECT t.id, t.title, t.type, t.subject, t.textbook, t.unit_name,
                  t.total_units, t.total_rounds, t.current_round, t.color,
                  t.archived, t.created_at, t.deleted_at,
                  (SELECT COALESCE(SUM(s.actual_units),0) FROM task_sessions s
                   WHERE s.task_id = t.id AND s.status = 'done' AND s.round = t.current_round)
           FROM tasks t WHERE t.deleted_at IS NULL ORDER BY t.archived ASC, t.id DESC"#
    } else {
        r#"SELECT t.id, t.title, t.type, t.subject, t.textbook, t.unit_name,
                  t.total_units, t.total_rounds, t.current_round, t.color,
                  t.archived, t.created_at, t.deleted_at,
                  (SELECT COALESCE(SUM(s.actual_units),0) FROM task_sessions s
                   WHERE s.task_id = t.id AND s.status = 'done' AND s.round = t.current_round)
           FROM tasks t WHERE t.archived = 0 AND t.deleted_at IS NULL ORDER BY t.id DESC"#
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_task)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn list_tasks(state: State<'_, DbState>, include_archived: bool) -> Result<Vec<Task>, String> {
    with_db(&state, |conn| list_tasks_impl(conn, include_archived))
}

#[tauri::command]
pub fn get_task(state: State<'_, DbState>, id: i64) -> Result<Task, String> {
    with_db(&state, |conn| fetch_task_impl(conn, id))
}

#[tauri::command]
pub fn create_task(state: State<'_, DbState>, payload: CreateTaskPayload) -> Result<Task, String> {
    with_db(&state, |conn| {
        conn.execute(
            r#"INSERT INTO tasks (title, type, subject, textbook, unit_name, total_units, total_rounds, color)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
            params![
                payload.title,
                payload.task_type,
                payload.subject,
                payload.textbook,
                payload.unit_name.unwrap_or_else(|| "课".into()),
                payload.total_units,
                payload.total_rounds.unwrap_or(1),
                payload.color,
            ],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        fetch_task_impl(conn, id)
    })
}

/// Update the editable fields of a task.
///
/// A field left as `None` keeps its current value. `subject` / `textbook`
/// accept an empty string to clear the column (stored back as NULL), so the
/// editor can drop a textbook without needing a separate "unset" signal.
pub fn update_task_impl(
    conn: &rusqlite::Connection,
    id: i64,
    payload: UpdateTaskPayload,
) -> Result<Task, String> {
    let mut task = fetch_task_impl(conn, id)?;
    if let Some(v) = payload.title {
        task.title = v;
    }
    if let Some(v) = payload.subject {
        let trimmed = v.trim();
        task.subject = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }
    if let Some(v) = payload.textbook {
        // 空串 = 清空课本，归回 NULL；否则去掉首尾空白后存下。
        let trimmed = v.trim();
        task.textbook = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }
    if let Some(v) = payload.unit_name {
        task.unit_name = v;
    }
    if let Some(v) = payload.total_units {
        task.total_units = Some(v);
    }
    if let Some(v) = payload.total_rounds {
        task.total_rounds = v;
    }
    if let Some(v) = payload.color {
        task.color = Some(v);
    }
    conn.execute(
        r#"UPDATE tasks SET title=?1, subject=?2, textbook=?3, unit_name=?4,
            total_units=?5, total_rounds=?6, color=?7 WHERE id=?8"#,
        params![
            task.title,
            task.subject,
            task.textbook,
            task.unit_name,
            task.total_units,
            task.total_rounds,
            task.color,
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    fetch_task_impl(conn, id)
}

#[tauri::command]
pub fn update_task(
    state: State<'_, DbState>,
    id: i64,
    payload: UpdateTaskPayload,
) -> Result<Task, String> {
    with_db(&state, |conn| update_task_impl(conn, id, payload))
}

/// 搁置 / 取消搁置。回收站里的任务不动：先恢复才能改归档位。
pub fn archive_task_impl(
    conn: &rusqlite::Connection,
    id: i64,
    archived: bool,
) -> Result<(), String> {
    let changed = conn
        .execute(
            "UPDATE tasks SET archived = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![if archived { 1 } else { 0 }, id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("任务 {id} 不存在或已在回收站里"));
    }
    Ok(())
}

#[tauri::command]
pub fn archive_task(state: State<'_, DbState>, id: i64, archived: bool) -> Result<(), String> {
    with_db(&state, |conn| archive_task_impl(conn, id, archived))
}

/// 回收站：被移到回收站的任务，按删除时间倒序。
///
/// 回收站里的任务不算在计划里（`list_tasks` 不返回它们），但排期与学习记录
/// 全部留着，恢复后原样回来。
pub fn list_deleted_tasks_impl(conn: &rusqlite::Connection) -> Result<Vec<Task>, String> {
    let mut stmt = conn
        .prepare(
            r#"SELECT t.id, t.title, t.type, t.subject, t.textbook, t.unit_name,
                      t.total_units, t.total_rounds, t.current_round, t.color,
                      t.archived, t.created_at, t.deleted_at,
                      (SELECT COALESCE(SUM(s.actual_units),0) FROM task_sessions s
                       WHERE s.task_id = t.id AND s.status = 'done' AND s.round = t.current_round)
               FROM tasks t WHERE t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC, t.id DESC"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_task)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn list_deleted_tasks(state: State<'_, DbState>) -> Result<Vec<Task>, String> {
    with_db(&state, list_deleted_tasks_impl)
}

/// 移入回收站：只打 `deleted_at` 标记，不删任何数据。
///
/// 排期与学习记录全部留着，恢复后原样回来；视图侧靠 `list_tasks` 与会话
/// JOIN 上的 `deleted_at IS NULL` 把它们藏起来，所以这个任务不会再出现在
/// 今天的安排里。
///
/// XP / 连击 / 成就当然也不动：学过就是学过，删除任务不能改写历史。
pub fn delete_task_impl(conn: &rusqlite::Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute(
            "UPDATE tasks SET deleted_at = datetime('now','localtime') WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("任务 {id} 不存在或已经在回收站里了"));
    }
    Ok(())
}

#[tauri::command]
pub fn delete_task(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| delete_task_impl(conn, id))
}

/// 从回收站找回任务：清掉 `deleted_at`，其它字段一律不动。
///
/// 恢复后任务回到它原来的位置（原本是搁置状态就仍然是搁置状态），
/// 排期与学习记录原样回来。
pub fn restore_task_impl(conn: &rusqlite::Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute(
            "UPDATE tasks SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("任务 {id} 不在回收站里"));
    }
    Ok(())
}

#[tauri::command]
pub fn restore_task(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| restore_task_impl(conn, id))
}

/// 彻底清除：物理删除回收站里的任务（删了就真没了）。
///
/// 回收站是「收起来」，这一步才是「抹掉」，所以只接受已经进回收站的任务——
/// 还在计划里的任务想删，得先走 `delete_task`。
///
/// 外键链决定了顺序：`actual_logs.session_id` -> `task_sessions`，
/// `task_sessions.task_id` -> `tasks`，`task_sessions.rescheduled_to` -> `task_sessions`
/// （自引用）。所以先把指向本任务排期的 rescheduled_to 置 NULL（既包括别的任务指向
/// 本任务的，也包括本任务内部的），再删学习流水，再删排期，最后删任务。
/// `task_knowledge_points` 是 `ON DELETE CASCADE`，跟着任务走。
///
/// XP / 连击 / 成就不动：它们是全局的，不属于某个任务。
pub fn purge_task_impl(conn: &rusqlite::Connection, id: i64) -> Result<(), String> {
    let deleted_at: Option<Option<String>> = conn
        .query_row("SELECT deleted_at FROM tasks WHERE id = ?1", params![id], |r| {
            r.get(0)
        })
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                format!("任务 {id} 不存在或已被彻底删除")
            }
            other => other.to_string(),
        })?;

    if deleted_at.flatten().is_none() {
        return Err(format!("任务 {id} 不在回收站里，先移入回收站才能彻底清除"));
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    // 指向本任务排期的 rescheduled_to 全部断开，否则自引用外键拦路。
    tx.execute(
        "UPDATE task_sessions SET rescheduled_to = NULL WHERE rescheduled_to IN (SELECT id FROM task_sessions WHERE task_id = ?1)",
        params![id],
    )
    .map_err(|e| e.to_string())?;

    // 挂在这些排期上的学习流水先清掉，否则外键拦路。
    tx.execute(
        "DELETE FROM actual_logs WHERE session_id IN (SELECT id FROM task_sessions WHERE task_id = ?1)",
        params![id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM task_sessions WHERE task_id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    let removed = tx
        .execute("DELETE FROM tasks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if removed == 0 {
        return Err(format!("任务 {id} 不存在或已被彻底删除"));
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn purge_task(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| purge_task_impl(conn, id))
}

/// Advance `current_round` by 1. No upper clamp against `total_rounds` (unbounded increment).
pub async fn advance_round_impl(db: &SqlitePool, id: i64) -> Result<Task, SessionError> {
    let row: Option<(i64, Option<String>)> =
        sqlx::query_as("SELECT id, deleted_at FROM tasks WHERE id = ?1")
            .bind(id)
            .fetch_optional(db)
            .await?;
    let Some((_, deleted_at)) = row else {
        return Err(SessionError::TaskNotFound { task_id: id });
    };
    // 回收站里的任务不推进轮次：先恢复才能接着推。
    if deleted_at.is_some() {
        return Err(SessionError::TaskDeleted { task_id: id });
    }

    sqlx::query("UPDATE tasks SET current_round = current_round + 1 WHERE id = ?1")
        .bind(id)
        .execute(db)
        .await?;

    fetch_task_sqlx(db, id).await
}

async fn fetch_task_sqlx(db: &SqlitePool, id: i64) -> Result<Task, SessionError> {
    let row = sqlx::query_as::<
        _,
        (
            i64,
            String,
            String,
            Option<String>,
            Option<String>,
            String,
            Option<i64>,
            i64,
            i64,
            Option<String>,
            i64,
            String,
            Option<String>,
            i64,
        ),
    >(
        r#"SELECT t.id, t.title, t.type, t.subject, t.textbook, t.unit_name,
                  t.total_units, t.total_rounds, t.current_round, t.color,
                  t.archived, t.created_at, t.deleted_at,
                  (SELECT COALESCE(SUM(s.actual_units),0) FROM task_sessions s
                   WHERE s.task_id = t.id AND s.status = 'done' AND s.round = t.current_round)
           FROM tasks t WHERE t.id = ?1"#,
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or(SessionError::TaskNotFound { task_id: id })?;

    Ok(Task {
        id: row.0,
        title: row.1,
        task_type: row.2,
        subject: row.3,
        textbook: row.4,
        unit_name: row.5,
        total_units: row.6,
        total_rounds: row.7,
        current_round: row.8,
        color: row.9,
        archived: row.10,
        created_at: row.11,
        deleted_at: row.12,
        actual_units_sum: Some(row.13),
    })
}

#[tauri::command]
pub async fn advance_round(pool: State<'_, SqlitePool>, id: i64) -> Result<Task, String> {
    advance_round_impl(pool.inner(), id)
        .await
        .map_err(Into::into)
}

/// Current-round progress for the ring. Filters `session.round = tasks.current_round`
/// (not “all rounds” and not `first_round`’s completing-session round).
pub fn task_progress_impl(conn: &rusqlite::Connection, id: i64) -> Result<TaskProgress, String> {
    let task = fetch_task_impl(conn, id)?;
    let round_units: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(actual_units),0) FROM task_sessions WHERE task_id=?1 AND round=?2 AND status='done'",
            params![id, task.current_round],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let total_units_done: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(actual_units),0) FROM task_sessions WHERE task_id=?1 AND status='done'",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(TaskProgress {
        round_units,
        total_units_done,
    })
}

#[tauri::command]
pub fn task_progress(state: State<'_, DbState>, id: i64) -> Result<TaskProgress, String> {
    with_db(&state, |conn| task_progress_impl(conn, id))
}
