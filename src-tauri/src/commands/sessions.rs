use crate::db::{with_db, DbState};
use crate::error::{AppError, SessionError};
use crate::gamification::{calc_session_xp, RESCHEDULE_RECOVERY_BONUS};
use crate::models::{
    CompleteSessionInput, CompleteSessionResult, CreateSessionPayload, RemainderSchedule,
    RescheduleInput, TaskSession,
};
use chrono::{DateTime, Local, NaiveDate};
use rusqlite::params;
use sqlx::{FromRow, SqlitePool};
use tauri::State;

/// Alias used by sqlx-backed session impls / tests.
pub type CompleteResult = CompleteSessionResult;

/// Test-only fault injection for rollback tests.
///
/// Note: integration tests under `tests/` do not build the lib with `cfg(test)`,
/// so this hook is always compiled but defaults to off.
pub mod test_hooks {
    use std::cell::Cell;

    thread_local! {
        static FAIL_ACTUAL_LOG_INSERT: Cell<bool> = const { Cell::new(false) };
    }

    pub fn set_fail_actual_log_insert(fail: bool) {
        FAIL_ACTUAL_LOG_INSERT.with(|c| c.set(fail));
    }

    pub(super) fn should_fail_actual_log_insert() -> bool {
        FAIL_ACTUAL_LOG_INSERT.with(|c| c.get())
    }
}

#[derive(Debug, FromRow)]
struct SessionJoinRow {
    id: i64,
    task_id: i64,
    date: String,
    start_time: String,
    end_time: String,
    round: i64,
    status: String,
    planned_units: i64,
    actual_units: i64,
    self_rating: Option<i64>,
    self_note: Option<String>,
    rescheduled_to: Option<i64>,
    xp_awarded: i64,
    created_at: String,
    title: String,
    task_type: String,
    color: Option<String>,
    subject: Option<String>,
}

impl SessionJoinRow {
    fn into_session(self) -> TaskSession {
        TaskSession {
            id: self.id,
            task_id: self.task_id,
            date: self.date,
            start_time: self.start_time,
            end_time: self.end_time,
            round: self.round,
            status: self.status,
            planned_units: self.planned_units,
            actual_units: self.actual_units,
            self_rating: self.self_rating,
            self_note: self.self_note,
            rescheduled_to: self.rescheduled_to,
            xp_awarded: self.xp_awarded,
            created_at: self.created_at,
            task_title: Some(self.title),
            task_type: Some(self.task_type),
            task_color: self.color,
            subject: self.subject,
        }
    }
}

const SESSION_JOIN_SQL: &str = r#"
SELECT s.id, s.task_id, s.date, s.start_time, s.end_time, s.round, s.status,
       s.planned_units, s.actual_units, s.self_rating, s.self_note, s.rescheduled_to,
       s.xp_awarded, s.created_at,
       t.title, t.type AS task_type, t.color, t.subject
FROM task_sessions s
JOIN tasks t ON t.id = s.task_id
"#;

fn map_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskSession> {
    Ok(TaskSession {
        id: row.get(0)?,
        task_id: row.get(1)?,
        date: row.get(2)?,
        start_time: row.get(3)?,
        end_time: row.get(4)?,
        round: row.get(5)?,
        status: row.get(6)?,
        planned_units: row.get(7)?,
        actual_units: row.get(8)?,
        self_rating: row.get(9)?,
        self_note: row.get(10)?,
        rescheduled_to: row.get(11)?,
        xp_awarded: row.get(12)?,
        created_at: row.get(13)?,
        task_title: row.get(14).ok(),
        task_type: row.get(15).ok(),
        task_color: row.get(16).ok(),
        subject: row.get(17).ok(),
    })
}

const SESSION_SELECT: &str = r#"
SELECT s.id, s.task_id, s.date, s.start_time, s.end_time, s.round, s.status,
       s.planned_units, s.actual_units, s.self_rating, s.self_note, s.rescheduled_to,
       s.xp_awarded, s.created_at,
       t.title, t.type, t.color, t.subject
FROM task_sessions s
JOIN tasks t ON t.id = s.task_id
"#;

/// Pad a parseable `H:MM` / `HH:MM` string to `HH:MM` (`"9:00"` → `"09:00"`).
/// Anything else (no colon, seconds, non-numeric) is stored unchanged.
fn normalize_hhmm(raw: &str) -> String {
    let Some((hour, minute)) = raw.split_once(':') else {
        return raw.to_string();
    };
    if minute.contains(':') {
        return raw.to_string();
    }
    let Ok(hour) = hour.parse::<u32>() else {
        return raw.to_string();
    };
    let Ok(minute) = minute.parse::<u32>() else {
        return raw.to_string();
    };
    format!("{hour:02}:{minute:02}")
}

fn duration_minutes(start: &str, end: &str) -> i64 {
    let parse = |s: &str| -> Option<i64> {
        let parts: Vec<_> = s.split(':').collect();
        if parts.len() < 2 {
            return None;
        }
        let h: i64 = parts[0].parse().ok()?;
        let m: i64 = parts[1].parse().ok()?;
        Some(h * 60 + m)
    };
    match (parse(start), parse(end)) {
        (Some(a), Some(b)) if b >= a => b - a,
        _ => 0,
    }
}

async fn fetch_session_sqlx(pool: &SqlitePool, id: i64) -> Result<TaskSession, AppError> {
    let row = sqlx::query_as::<_, SessionJoinRow>(&format!("{SESSION_JOIN_SQL} WHERE s.id = ?1"))
        .bind(id)
        .fetch_one(pool)
        .await?;
    Ok(row.into_session())
}

async fn fetch_session_sqlx_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: i64,
) -> Result<TaskSession, AppError> {
    let row = sqlx::query_as::<_, SessionJoinRow>(&format!("{SESSION_JOIN_SQL} WHERE s.id = ?1"))
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;
    Ok(row.into_session())
}

/// Pure (Tauri-free) complete flow for tests and commands.
///
/// When `move_remainder` is true and remaining units > 0, a new planned session is
/// created. Slot comes from `remainder` if provided, otherwise `now`'s local date
/// at 19:00–20:00.
pub async fn complete_session_impl(
    db: &SqlitePool,
    session_id: i64,
    actual_units: i64,
    self_rating: Option<i64>,
    self_note: Option<String>,
    move_remainder: bool,
    now: DateTime<Local>,
    remainder: Option<RemainderSchedule>,
) -> Result<CompleteResult, SessionError> {
    // Reject before any DB write / transaction work. Non-negative bound is
    // application-layer only (see SessionError::InvalidActualUnits).
    if actual_units < 0 {
        return Err(SessionError::InvalidActualUnits { actual_units });
    }
    // Zero progress + defer: reject before begin() — no actual_logs, no remainder spawn.
    // Use reschedule instead; actual_units=0 without move_remainder remains allowed.
    if actual_units == 0 && move_remainder {
        return Err(SessionError::ZeroUnitsCannotDefer);
    }

    let mut tx = db.begin().await?;
    let session = fetch_session_sqlx_tx(&mut tx, session_id)
        .await
        .map_err(|e| SessionError::Message(e.to_string()))?;

    if session.status == "done" {
        tx.commit().await?;
        return Ok(CompleteResult {
            session,
            xp_awarded: 0,
            new_achievements: vec![],
            created_session_id: None,
            remainder_session_id: None,
        });
    }
    if session.status != "planned" {
        tx.rollback().await.ok();
        return Err(SessionError::InvalidCompleteStatus {
            status: session.status,
        });
    }

    // All writes below stay on this transaction until commit — any Err drops `tx` and rolls back.
    let task_type = session.task_type.clone().unwrap_or_else(|| "side".into());
    let subject = session.subject.clone();
    let rating = self_rating.unwrap_or(3);

    let total_units: Option<i64> =
        sqlx::query_scalar("SELECT total_units FROM tasks WHERE id = ?1")
            .bind(session.task_id)
            .fetch_one(&mut *tx)
            .await?;

    let came_from: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions WHERE rescheduled_to = ?1")
            .bind(session.id)
            .fetch_one(&mut *tx)
            .await?;
    let came_from_reschedule = came_from > 0;

    let streak: i64 = sqlx::query_scalar("SELECT current_streak FROM user_stats WHERE id = 1")
        .fetch_one(&mut *tx)
        .await?;

    let mut xp = calc_session_xp(actual_units, &task_type, rating, streak);
    if came_from_reschedule && actual_units > 0 && rating >= 4 {
        xp += RESCHEDULE_RECOVERY_BONUS;
    }

    sqlx::query(
        r#"UPDATE task_sessions SET status='done', actual_units=?1, self_rating=?2,
            self_note=?3, xp_awarded=?4 WHERE id=?5"#,
    )
    .bind(actual_units)
    .bind(rating)
    .bind(&self_note)
    .bind(xp)
    .bind(session.id)
    .execute(&mut *tx)
    .await?;

    if test_hooks::should_fail_actual_log_insert() {
        // Leave `tx` to Drop → rollback of the session UPDATE above.
        return Err(SessionError::Message(
            "inject: actual_logs insert failed".into(),
        ));
    }

    // Zero actual units → no study time recorded (and no XP); avoid inventing minutes.
    let dur = if actual_units <= 0 {
        0
    } else {
        duration_minutes(&session.start_time, &session.end_time).max(1)
    };
    sqlx::query(
        r#"INSERT INTO actual_logs (date, start_at, end_at, duration_min, subject, method, tag_type, session_id, note)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'study', ?7, ?8)"#,
    )
    .bind(&session.date)
    .bind(format!("{}T{}:00", session.date, session.start_time))
    .bind(format!("{}T{}:00", session.date, session.end_time))
    .bind(dur)
    .bind(&subject)
    .bind("刷题")
    .bind(session.id)
    .bind(&self_note)
    .execute(&mut *tx)
    .await?;

    // Commit before XP helpers that use pool (separate connection) would deadlock on single-conn pools.
    // Apply XP inside the same transaction instead.
    {
        let row: (i64, i64, i64, Option<String>) = sqlx::query_as(
            "SELECT total_xp, current_streak, longest_streak, last_done_date FROM user_stats WHERE id = 1",
        )
        .fetch_one(&mut *tx)
        .await?;
        let (total_xp, current_streak, longest_streak, last_done) = row;
        let (new_streak, new_longest, new_last) = crate::gamification::update_streak_values(
            current_streak,
            longest_streak,
            last_done.as_deref(),
            &session.date,
        );
        let award = if actual_units > 0 { xp } else { 0 };
        let new_total = total_xp + award;
        let new_level = crate::gamification::level_from_total_xp(new_total);
        if actual_units > 0 {
            sqlx::query(
                "UPDATE user_stats SET total_xp = ?1, current_level = ?2, current_streak = ?3, longest_streak = ?4, last_done_date = ?5 WHERE id = 1",
            )
            .bind(new_total)
            .bind(new_level)
            .bind(new_streak)
            .bind(new_longest)
            .bind(new_last)
            .execute(&mut *tx)
            .await?;
        }
    }

    let mut created_session_id = None;
    let mut remainder_session_id = None;
    let remaining = session.planned_units - actual_units;
    if move_remainder && remaining > 0 {
        let slot = remainder.unwrap_or_else(|| RemainderSchedule {
            date: now.format("%Y-%m-%d").to_string(),
            start_time: "19:00".into(),
            end_time: "20:00".into(),
        });
        let result = sqlx::query(
            r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, planned_units)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
        )
        .bind(session.task_id)
        .bind(&slot.date)
        .bind(&slot.start_time)
        .bind(&slot.end_time)
        .bind(session.round)
        .bind(remaining)
        .execute(&mut *tx)
        .await?;
        let new_id = result.last_insert_rowid();
        created_session_id = Some(new_id);
        remainder_session_id = Some(new_id);
    }

    // Achievements (inline to stay on same tx)
    let unlocked = {
        let mut unlocked = Vec::new();
        if task_type == "main" {
            // NULL（Option::None）或 <= 0 不进入比较，避免 0 >= 0 解锁。
            if let Some(total) = total_units.filter(|units| *units > 0) {
                let done: i64 = sqlx::query_scalar(
                    "SELECT COALESCE(SUM(actual_units),0) FROM task_sessions WHERE task_id = ?1 AND round = ?2 AND status = 'done'",
                )
                .bind(session.task_id)
                .bind(session.round)
                .fetch_one(&mut *tx)
                .await?;
                if done >= total {
                    let exists: Option<String> = sqlx::query_scalar(
                        "SELECT achievement_id FROM user_achievements WHERE achievement_id = 'first_round'",
                    )
                    .fetch_optional(&mut *tx)
                    .await?;
                    if exists.is_none() {
                        sqlx::query(
                            "INSERT INTO user_achievements (achievement_id) VALUES ('first_round')",
                        )
                        .execute(&mut *tx)
                        .await?;
                        unlocked.push("first_round".into());
                    }
                }
            }
        }
        if came_from_reschedule && actual_units > 0 && rating >= 4 {
            let exists: Option<String> = sqlx::query_scalar(
                "SELECT achievement_id FROM user_achievements WHERE achievement_id = 'comeback'",
            )
            .fetch_optional(&mut *tx)
            .await?;
            if exists.is_none() {
                sqlx::query("INSERT INTO user_achievements (achievement_id) VALUES ('comeback')")
                    .execute(&mut *tx)
                    .await?;
                unlocked.push("comeback".into());
            }
        }
        // 窗口锚在本场 session.date，闭区间 [date-6, date]，不用 SQLite now。
        let has_main: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_sessions s JOIN tasks t ON t.id = s.task_id
             WHERE s.status = 'done' AND t.type = 'main' AND s.actual_units > 0
               AND date(s.date) >= date(?1, '-6 days')
               AND date(s.date) <= date(?1)",
        )
        .bind(&session.date)
        .fetch_one(&mut *tx)
        .await?;
        let has_side: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_sessions s JOIN tasks t ON t.id = s.task_id
             WHERE s.status = 'done' AND t.type = 'side' AND s.actual_units > 0
               AND date(s.date) >= date(?1, '-6 days')
               AND date(s.date) <= date(?1)",
        )
        .bind(&session.date)
        .fetch_one(&mut *tx)
        .await?;
        if has_main > 0 && has_side > 0 {
            let exists: Option<String> = sqlx::query_scalar(
                "SELECT achievement_id FROM user_achievements WHERE achievement_id = 'balanced'",
            )
            .fetch_optional(&mut *tx)
            .await?;
            if exists.is_none() {
                sqlx::query("INSERT INTO user_achievements (achievement_id) VALUES ('balanced')")
                    .execute(&mut *tx)
                    .await?;
                unlocked.push("balanced".into());
            }
        }
        let streak_now: i64 =
            sqlx::query_scalar("SELECT current_streak FROM user_stats WHERE id = 1")
                .fetch_one(&mut *tx)
                .await?;
        if streak_now >= 5 {
            let exists: Option<String> = sqlx::query_scalar(
                "SELECT achievement_id FROM user_achievements WHERE achievement_id = 'streak_5'",
            )
            .fetch_optional(&mut *tx)
            .await?;
            if exists.is_none() {
                sqlx::query("INSERT INTO user_achievements (achievement_id) VALUES ('streak_5')")
                    .execute(&mut *tx)
                    .await?;
                unlocked.push("streak_5".into());
            }
        }
        unlocked
    };

    let updated_id = session.id;
    tx.commit().await?;

    let updated = fetch_session_sqlx(db, updated_id)
        .await
        .map_err(|e| SessionError::Message(e.to_string()))?;

    Ok(CompleteResult {
        session: updated,
        xp_awarded: if actual_units > 0 { xp } else { 0 },
        new_achievements: unlocked,
        created_session_id,
        remainder_session_id,
    })
}

/// Create a planned session (Tauri-free). Rejects archived tasks.
pub async fn create_session_impl(
    db: &SqlitePool,
    task_id: i64,
    date: String,
    start_time: String,
    end_time: String,
    round: Option<i64>,
    planned_units: Option<i64>,
) -> Result<TaskSession, SessionError> {
    let row: Option<(i64, i64)> =
        sqlx::query_as("SELECT current_round, archived FROM tasks WHERE id = ?1")
            .bind(task_id)
            .fetch_optional(db)
            .await?;

    let Some((current_round, archived)) = row else {
        return Err(SessionError::TaskNotFound { task_id });
    };
    if archived != 0 {
        return Err(SessionError::TaskArchived { task_id });
    }

    let round = round.unwrap_or(current_round);
    let planned = planned_units.unwrap_or(0);
    let start_time = normalize_hhmm(&start_time);
    let end_time = normalize_hhmm(&end_time);

    let result = sqlx::query(
        r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, planned_units)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
    )
    .bind(task_id)
    .bind(&date)
    .bind(&start_time)
    .bind(&end_time)
    .bind(round)
    .bind(planned)
    .execute(db)
    .await?;

    fetch_session_sqlx(db, result.last_insert_rowid())
        .await
        .map_err(|e| SessionError::Message(e.to_string()))
}

/// Pure (Tauri-free) reschedule flow.
pub async fn reschedule_session_impl(
    db: &SqlitePool,
    session_id: i64,
    date: String,
    start_time: String,
    end_time: String,
    _now: DateTime<Local>,
) -> Result<CompleteResult, AppError> {
    let mut tx = db.begin().await?;
    let session = fetch_session_sqlx_tx(&mut tx, session_id).await?;

    if session.status != "planned" {
        if session.status == "rescheduled" {
            let created = session.rescheduled_to;
            tx.commit().await?;
            return Ok(CompleteResult {
                session,
                xp_awarded: 0,
                new_achievements: vec![],
                created_session_id: created,
                remainder_session_id: None,
            });
        }
        return Err(AppError::msg(format!(
            "cannot reschedule status {}",
            session.status
        )));
    }

    let insert = sqlx::query(
        r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, planned_units)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
    )
    .bind(session.task_id)
    .bind(&date)
    .bind(&start_time)
    .bind(&end_time)
    .bind(session.round)
    .bind(session.planned_units)
    .execute(&mut *tx)
    .await?;
    let new_id = insert.last_insert_rowid();

    sqlx::query("UPDATE task_sessions SET status='rescheduled', rescheduled_to=?1 WHERE id=?2")
        .bind(new_id)
        .bind(session.id)
        .execute(&mut *tx)
        .await?;

    let old_id = session.id;
    tx.commit().await?;

    let updated = fetch_session_sqlx(db, old_id).await?;
    Ok(CompleteResult {
        session: updated,
        xp_awarded: 0,
        new_achievements: vec![],
        created_session_id: Some(new_id),
        remainder_session_id: None,
    })
}

/// Pad a parseable `Y-M-D` bound to `YYYY-MM-DD` (`"2026-11-1"` → `"2026-11-01"`).
/// Unparseable text is left unchanged, same policy as stats date bounds.
fn normalize_ymd(raw: &str) -> String {
    let parts: Vec<&str> = raw.split('-').collect();
    if parts.len() != 3 {
        return raw.to_string();
    }
    let Ok(year) = parts[0].parse::<i32>() else {
        return raw.to_string();
    };
    let Ok(month) = parts[1].parse::<u32>() else {
        return raw.to_string();
    };
    let Ok(day) = parts[2].parse::<u32>() else {
        return raw.to_string();
    };
    NaiveDate::from_ymd_opt(year, month, day)
        .map(|date| date.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| raw.to_string())
}

/// Inclusive `[start_date, end_date]`, ordered by date then start time.
/// `start > end` returns an empty vec and does not scan the table.
pub async fn list_sessions_in_range_impl(
    db: &SqlitePool,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<TaskSession>, String> {
    let start = normalize_ymd(start_date);
    let end = normalize_ymd(end_date);
    if start > end {
        return Ok(Vec::new());
    }
    let rows = sqlx::query_as::<_, SessionJoinRow>(&format!(
        "{SESSION_JOIN_SQL} WHERE s.date >= ?1 AND s.date <= ?2 ORDER BY s.date ASC, s.start_time ASC"
    ))
    .bind(&start)
    .bind(&end)
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(SessionJoinRow::into_session).collect())
}

#[tauri::command]
pub async fn list_sessions_in_range(
    pool: State<'_, SqlitePool>,
    start_date: String,
    end_date: String,
) -> Result<Vec<TaskSession>, String> {
    list_sessions_in_range_impl(pool.inner(), &start_date, &end_date).await
}

#[tauri::command]
pub fn list_sessions_by_date(
    state: State<'_, DbState>,
    date: String,
) -> Result<Vec<TaskSession>, String> {
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare(&format!(
                "{SESSION_SELECT} WHERE s.date = ?1 ORDER BY s.start_time ASC"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![date], map_session)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn list_sessions_by_task(
    state: State<'_, DbState>,
    task_id: i64,
) -> Result<Vec<TaskSession>, String> {
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare(&format!(
                "{SESSION_SELECT} WHERE s.task_id = ?1 ORDER BY s.date DESC, s.start_time DESC"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![task_id], map_session)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

#[tauri::command]
pub async fn create_session(
    pool: State<'_, SqlitePool>,
    payload: CreateSessionPayload,
) -> Result<TaskSession, String> {
    create_session_impl(
        pool.inner(),
        payload.task_id,
        payload.date,
        payload.start_time,
        payload.end_time,
        payload.round,
        payload.planned_units,
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub fn find_overlaps(
    state: State<'_, DbState>,
    date: String,
    start_time: String,
    end_time: String,
    exclude_id: Option<i64>,
) -> Result<Vec<TaskSession>, String> {
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare(&format!(
                "{SESSION_SELECT}
                 WHERE s.date = ?1 AND s.status = 'planned'
                   AND s.start_time < ?3 AND ?2 < s.end_time
                   AND (?4 IS NULL OR s.id != ?4)"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![date, start_time, end_time, exclude_id], map_session)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

#[tauri::command]
pub async fn complete_session(
    pool: State<'_, SqlitePool>,
    input: CompleteSessionInput,
) -> Result<CompleteSessionResult, String> {
    let now = Local::now();
    let remainder = match (&input.defer_date, &input.defer_start, &input.defer_end) {
        (Some(d), Some(st), Some(et)) => Some(RemainderSchedule {
            date: d.clone(),
            start_time: st.clone(),
            end_time: et.clone(),
        }),
        _ => None,
    };

    let mut result = complete_session_impl(
        pool.inner(),
        input.session_id,
        input.actual_units,
        Some(input.self_rating),
        input.self_note.clone(),
        input.defer_remaining.unwrap_or(false),
        now,
        remainder,
    )
    .await
    .map_err(|e| e.to_string())?;

    if let Some(method) = &input.method {
        sqlx::query("UPDATE actual_logs SET method = ?1 WHERE session_id = ?2")
            .bind(method)
            .bind(input.session_id)
            .execute(pool.inner())
            .await
            .map_err(|e| e.to_string())?;
        result.session = fetch_session_sqlx(pool.inner(), input.session_id)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn reschedule_session(
    pool: State<'_, SqlitePool>,
    input: RescheduleInput,
) -> Result<CompleteSessionResult, String> {
    reschedule_session_impl(
        pool.inner(),
        input.session_id,
        input.date,
        input.start_time,
        input.end_time,
        Local::now(),
    )
    .await
    .map_err(|e| e.to_string())
}
