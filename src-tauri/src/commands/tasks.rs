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
        actual_units_sum: row.get(12).ok(),
    })
}

fn fetch_task(conn: &rusqlite::Connection, id: i64) -> Result<Task, String> {
    conn.query_row(
        r#"SELECT t.id, t.title, t.type, t.subject, t.textbook, t.unit_name,
                  t.total_units, t.total_rounds, t.current_round, t.color,
                  t.archived, t.created_at,
                  (SELECT COALESCE(SUM(s.actual_units),0) FROM task_sessions s
                   WHERE s.task_id = t.id AND s.status = 'done' AND s.round = t.current_round)
           FROM tasks t WHERE t.id = ?1"#,
        params![id],
        map_task,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_tasks(state: State<'_, DbState>, include_archived: bool) -> Result<Vec<Task>, String> {
    with_db(&state, |conn| {
        let sql = if include_archived {
            r#"SELECT t.id, t.title, t.type, t.subject, t.textbook, t.unit_name,
                      t.total_units, t.total_rounds, t.current_round, t.color,
                      t.archived, t.created_at,
                      (SELECT COALESCE(SUM(s.actual_units),0) FROM task_sessions s
                       WHERE s.task_id = t.id AND s.status = 'done' AND s.round = t.current_round)
               FROM tasks t ORDER BY t.archived ASC, t.id DESC"#
        } else {
            r#"SELECT t.id, t.title, t.type, t.subject, t.textbook, t.unit_name,
                      t.total_units, t.total_rounds, t.current_round, t.color,
                      t.archived, t.created_at,
                      (SELECT COALESCE(SUM(s.actual_units),0) FROM task_sessions s
                       WHERE s.task_id = t.id AND s.status = 'done' AND s.round = t.current_round)
               FROM tasks t WHERE t.archived = 0 ORDER BY t.id DESC"#
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], map_task)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn get_task(state: State<'_, DbState>, id: i64) -> Result<Task, String> {
    with_db(&state, |conn| fetch_task(conn, id))
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
        fetch_task(conn, id)
    })
}

#[tauri::command]
pub fn update_task(
    state: State<'_, DbState>,
    id: i64,
    payload: UpdateTaskPayload,
) -> Result<Task, String> {
    with_db(&state, |conn| {
        let mut task = fetch_task(conn, id)?;
        if let Some(v) = payload.title {
            task.title = v;
        }
        if let Some(v) = payload.subject {
            task.subject = Some(v);
        }
        if let Some(v) = payload.textbook {
            task.textbook = Some(v);
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
        fetch_task(conn, id)
    })
}

#[tauri::command]
pub fn archive_task(state: State<'_, DbState>, id: i64, archived: bool) -> Result<(), String> {
    with_db(&state, |conn| {
        conn.execute(
            "UPDATE tasks SET archived = ?1 WHERE id = ?2",
            params![if archived { 1 } else { 0 }, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Advance `current_round` by 1. No upper clamp against `total_rounds` (unbounded increment).
pub async fn advance_round_impl(db: &SqlitePool, id: i64) -> Result<Task, SessionError> {
    let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM tasks WHERE id = ?1")
        .bind(id)
        .fetch_optional(db)
        .await?;
    if exists.is_none() {
        return Err(SessionError::TaskNotFound { task_id: id });
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
            i64,
        ),
    >(
        r#"SELECT t.id, t.title, t.type, t.subject, t.textbook, t.unit_name,
                  t.total_units, t.total_rounds, t.current_round, t.color,
                  t.archived, t.created_at,
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
        actual_units_sum: Some(row.12),
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
    let task = fetch_task(conn, id)?;
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
