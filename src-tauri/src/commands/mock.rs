//! Hunan grade-11 demo rows. Every inserted task, session, and exam is `is_mock = 1`.
//! No `actual_logs` rows: those have no mock flag, and stats read them as real minutes.
//! Demo XP is written only onto a still-initial `user_stats` row when nothing real exists.
//! Clearing deletes mock rows (and logs that point at mock sessions) and resets stats
//! only when that delete actually removed something and no real rows remain.

use crate::db::{with_db, DbState};
use crate::gamification::{calc_session_xp, level_from_total_xp};
use chrono::NaiveDate;
use rusqlite::{params, Connection};
use tauri::State;

const DEMO_STREAK: i64 = 7;
const DEMO_LONGEST: i64 = 12;

struct MockTask {
    title: &'static str,
    subject: &'static str,
    textbook: &'static str,
    total_units: i64,
    color: &'static str,
}

const MOCK_TASKS: &[MockTask] = &[
    MockTask {
        title: "数学必修一",
        subject: "数学",
        textbook: "人教A版",
        total_units: 18,
        color: "#F97316",
    },
    MockTask {
        title: "物理必修一",
        subject: "物理",
        textbook: "人教版",
        total_units: 14,
        color: "#38BDF8",
    },
    MockTask {
        title: "英语必修一",
        subject: "英语",
        textbook: "人教版",
        total_units: 16,
        color: "#34D399",
    },
];

struct MockSession {
    task_index: usize,
    start: &'static str,
    end: &'static str,
    status: &'static str,
    planned: i64,
    actual: i64,
    rating: Option<i64>,
}

const MOCK_SESSIONS: &[MockSession] = &[
    MockSession {
        task_index: 0,
        start: "07:30",
        end: "08:30",
        status: "done",
        planned: 4,
        actual: 4,
        rating: Some(4),
    },
    MockSession {
        task_index: 1,
        start: "08:40",
        end: "09:40",
        status: "done",
        planned: 3,
        actual: 3,
        rating: Some(4),
    },
    MockSession {
        task_index: 2,
        start: "19:00",
        end: "20:00",
        status: "planned",
        planned: 2,
        actual: 0,
        rating: None,
    },
    MockSession {
        task_index: 0,
        start: "20:10",
        end: "21:10",
        status: "planned",
        planned: 1,
        actual: 0,
        rating: None,
    },
];

struct MockExam {
    name: &'static str,
    days_ago: i64,
    chinese: i64,
    math: i64,
    english: i64,
    physics: i64,
    chemistry: i64,
    biology: i64,
}

const MOCK_EXAMS: &[MockExam] = &[
    MockExam {
        name: "高二上期中",
        days_ago: 45,
        chinese: 105,
        math: 118,
        english: 112,
        physics: 68,
        chemistry: 71,
        biology: 74,
    },
    MockExam {
        name: "高二月考",
        days_ago: 18,
        chinese: 110,
        math: 124,
        english: 115,
        physics: 73,
        chemistry: 69,
        biology: 76,
    },
];

fn today() -> NaiveDate {
    chrono::Local::now().date_naive()
}

fn date_string(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

fn days_before(today: NaiveDate, days: i64) -> String {
    let shifted = today
        .checked_sub_signed(chrono::Duration::days(days))
        .unwrap_or(today);
    date_string(shifted)
}

fn has_real_rows(conn: &Connection) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            r#"SELECT
                 (SELECT COUNT(*) FROM tasks WHERE is_mock = 0)
               + (SELECT COUNT(*) FROM task_sessions WHERE is_mock = 0)
               + (SELECT COUNT(*) FROM exam_records WHERE is_mock = 0)
               + (SELECT COUNT(*) FROM actual_logs)"#,
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

fn stats_are_initial(conn: &Connection) -> Result<bool, String> {
    let (xp, streak, longest, last): (i64, i64, i64, Option<String>) = conn
        .query_row(
            "SELECT total_xp, current_streak, longest_streak, last_done_date FROM user_stats WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok(xp == 0 && streak == 0 && longest == 0 && last.is_none())
}

pub fn has_mock_data_impl(conn: &Connection) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            r#"SELECT
                 (SELECT COUNT(*) FROM tasks WHERE is_mock = 1)
               + (SELECT COUNT(*) FROM task_sessions WHERE is_mock = 1)
               + (SELECT COUNT(*) FROM exam_records WHERE is_mock = 1)"#,
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

pub fn generate_mock_data_impl(conn: &Connection) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let existing: i64 = tx
        .query_row("SELECT COUNT(*) FROM tasks WHERE is_mock = 1", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    if existing > 0 {
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let apply_stats = stats_are_initial(&tx)? && !has_real_rows(&tx)?;
    let today = today();
    let today_s = date_string(today);

    let mut task_ids = Vec::with_capacity(MOCK_TASKS.len());
    for task in MOCK_TASKS {
        tx.execute(
            r#"INSERT INTO tasks (
                 title, type, subject, textbook, unit_name, total_units,
                 total_rounds, current_round, color, archived, is_mock
               ) VALUES (?1, 'main', ?2, ?3, '课', ?4, 1, 1, ?5, 0, 1)"#,
            params![
                task.title,
                task.subject,
                task.textbook,
                task.total_units,
                task.color
            ],
        )
        .map_err(|e| e.to_string())?;
        task_ids.push(tx.last_insert_rowid());
    }

    let mut total_xp = 0i64;
    for session in MOCK_SESSIONS {
        let task_id = task_ids[session.task_index];
        let xp = if session.status == "done" {
            calc_session_xp(
                session.actual,
                "main",
                session.rating.unwrap_or(0),
                DEMO_STREAK,
            )
        } else {
            0
        };
        total_xp += xp;
        tx.execute(
            r#"INSERT INTO task_sessions (
                 task_id, date, start_time, end_time, round, status,
                 planned_units, actual_units, self_rating, xp_awarded, is_mock
               ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, ?9, 1)"#,
            params![
                task_id,
                today_s,
                session.start,
                session.end,
                session.status,
                session.planned,
                session.actual,
                session.rating,
                xp,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    for exam in MOCK_EXAMS {
        tx.execute(
            r#"INSERT INTO exam_records (
                 exam_name, exam_date, chinese_score, math_score, english_score,
                 physics_score, chemistry_score, biology_score, is_mock
               ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)"#,
            params![
                exam.name,
                days_before(today, exam.days_ago),
                exam.chinese,
                exam.math,
                exam.english,
                exam.physics,
                exam.chemistry,
                exam.biology,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    if apply_stats {
        let level = level_from_total_xp(total_xp);
        let changed = tx
            .execute(
                r#"UPDATE user_stats
                   SET total_xp = ?1,
                       current_level = ?2,
                       current_streak = ?3,
                       longest_streak = ?4,
                       last_done_date = ?5
                   WHERE id = 1"#,
                params![total_xp, level, DEMO_STREAK, DEMO_LONGEST, today_s],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("user_stats 缺失，无法写入演示进度".to_string());
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_mock_data_impl(conn: &Connection) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let logs = tx
        .execute(
            "DELETE FROM actual_logs WHERE session_id IN (SELECT id FROM task_sessions WHERE is_mock = 1)",
            [],
        )
        .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE task_sessions SET rescheduled_to = NULL WHERE is_mock = 1",
        [],
    )
    .map_err(|e| e.to_string())?;
    let sessions = tx
        .execute("DELETE FROM task_sessions WHERE is_mock = 1", [])
        .map_err(|e| e.to_string())?;
    let exams = tx
        .execute("DELETE FROM exam_records WHERE is_mock = 1", [])
        .map_err(|e| e.to_string())?;
    // A mock task that still has a real session stays. Deleting it would
    // either fail the foreign key or take the real session with it.
    let tasks = tx
        .execute(
            "DELETE FROM tasks WHERE is_mock = 1 AND id NOT IN (SELECT task_id FROM task_sessions)",
            [],
        )
        .map_err(|e| e.to_string())?;

    if logs + sessions + exams + tasks > 0 && !has_real_rows(&tx)? {
        tx.execute(
            r#"UPDATE user_stats
               SET total_xp = 0,
                   current_level = 1,
                   current_streak = 0,
                   longest_streak = 0,
                   last_done_date = NULL
               WHERE id = 1"#,
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn has_mock_data(state: State<'_, DbState>) -> Result<bool, String> {
    with_db(&state, has_mock_data_impl)
}

#[tauri::command]
pub fn generate_mock_data(state: State<'_, DbState>) -> Result<(), String> {
    with_db(&state, generate_mock_data_impl)
}

#[tauri::command]
pub fn clear_mock_data(state: State<'_, DbState>) -> Result<(), String> {
    with_db(&state, clear_mock_data_impl)
}
