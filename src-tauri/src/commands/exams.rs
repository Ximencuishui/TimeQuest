//! 成绩行化：一次考试 = 一行场次 + 每科一行成绩。
//!
//! 老结构 `exam_records` 一行塞六科分数，换赛道就装不下别的科目。
//! 现在场次在 `exam_sessions`，各科成绩在 `exam_scores`，
//! 科目集合由 `subjects` 表决定。

use crate::commands::subjects::{subject_id_for_key, subject_label};
use crate::db::{with_db, DbState};
use crate::models::{CreateExamSessionPayload, ExamScore, ExamSessionWithScores};
use chrono::NaiveDate;
use rusqlite::{params, Connection};
use tauri::State;

const SELECT_SESSION: &str = "SELECT id, track_id, name, date, created_at FROM exam_sessions";
const SELECT_SCORES: &str = "SELECT id, exam_id, subject_id, score FROM exam_scores";

fn map_score(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExamScore> {
    Ok(ExamScore {
        id: row.get(0)?,
        exam_id: row.get(1)?,
        subject_id: row.get(2)?,
        score: row.get(3)?,
    })
}

fn normalize_exam_date(raw: &str) -> Result<String, String> {
    let parts: Vec<&str> = raw.trim().split('-').collect();
    if parts.len() != 3 {
        return Err("考试日期格式应为 YYYY-MM-DD".to_string());
    }
    let Ok(year) = parts[0].parse::<i32>() else {
        return Err("考试日期格式应为 YYYY-MM-DD".to_string());
    };
    let Ok(month) = parts[1].parse::<u32>() else {
        return Err("考试日期格式应为 YYYY-MM-DD".to_string());
    };
    let Ok(day) = parts[2].parse::<u32>() else {
        return Err("考试日期格式应为 YYYY-MM-DD".to_string());
    };
    NaiveDate::from_ymd_opt(year, month, day)
        .map(|date| date.format("%Y-%m-%d").to_string())
        .ok_or_else(|| "考试日期无效".to_string())
}

/// 负分直接挡掉。`None`（这场没考这科）不算错。
fn reject_negative(label: &str, score: Option<f64>) -> Result<(), String> {
    if score.is_some_and(|value| value < 0.0) {
        return Err(format!("{label}成绩不能为负数"));
    }
    Ok(())
}

/// 一场考试的各科成绩。没考的科目也有一行，`score` 为 `None`。
fn load_scores(conn: &Connection, exam_id: i64) -> Result<Vec<ExamScore>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "{SELECT_SCORES} WHERE exam_id = ?1 ORDER BY subject_id"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![exam_id], map_score)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 新建一次考试：场次 + 各科成绩，同一事务。
///
/// 科目 key 在 `subjects` 表里找不到就报错 —— 宁可不让存，也不写一条
/// 没有科目的成绩行，那会让成绩页算不出总分。
pub fn create_exam_session_impl(
    conn: &Connection,
    payload: CreateExamSessionPayload,
) -> Result<ExamSessionWithScores, String> {
    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Err("请填写考试名称".to_string());
    }
    let date = normalize_exam_date(&payload.date)?;

    // 先把每科成绩解析成 (科目 id, 分数)，顺带挡掉未知科目和负分。
    let mut resolved: Vec<(i64, Option<f64>)> = Vec::with_capacity(payload.scores.len());
    let mut has_score = false;
    for input in &payload.scores {
        let key = input.subject_key.trim();
        if key.is_empty() {
            continue;
        }
        let Some(subject_id) = subject_id_for_key(conn, key)? else {
            return Err(format!("科目「{key}」不存在"));
        };
        let label = subject_label(conn, subject_id)?.unwrap_or_else(|| key.to_string());
        reject_negative(&label, input.score)?;
        if input.score.is_some() {
            has_score = true;
        }
        resolved.push((subject_id, input.score));
    }
    if !has_score {
        return Err("请至少填写一科成绩".to_string());
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        r#"INSERT INTO exam_sessions (track_id, name, date) VALUES (?1, ?2, ?3)"#,
        params![payload.track_id, name, date],
    )
    .map_err(|e| e.to_string())?;
    let exam_id = tx.last_insert_rowid();
    for (subject_id, score) in resolved {
        tx.execute(
            r#"INSERT INTO exam_scores (exam_id, subject_id, score) VALUES (?1, ?2, ?3)"#,
            params![exam_id, subject_id, score],
        )
        .map_err(|e| e.to_string())?;
    }
    let session = tx
        .query_row(
            &format!("{SELECT_SESSION} WHERE id = ?1"),
            params![exam_id],
            |row| {
                Ok(ExamSessionWithScores {
                    id: row.get(0)?,
                    track_id: row.get(1)?,
                    name: row.get(2)?,
                    date: row.get(3)?,
                    created_at: row.get(4)?,
                    scores: Vec::new(),
                })
            },
        )
        .map_err(|e| e.to_string())?;
    let scores = load_scores(&tx, exam_id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(ExamSessionWithScores { scores, ..session })
}

/// 全部考试场次（带各科成绩）。日期新的在前，同日按 id 倒序。
pub fn list_exam_sessions_impl(conn: &Connection) -> Result<Vec<ExamSessionWithScores>, String> {
    let mut stmt = conn
        .prepare(&format!("{SELECT_SESSION} ORDER BY date DESC, id DESC"))
        .map_err(|e| e.to_string())?;
    let sessions = stmt
        .query_map([], |row| {
            Ok(ExamSessionWithScores {
                id: row.get(0)?,
                track_id: row.get(1)?,
                name: row.get(2)?,
                date: row.get(3)?,
                created_at: row.get(4)?,
                scores: Vec::new(),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(sessions.len());
    for mut session in sessions {
        session.scores = load_scores(conn, session.id)?;
        out.push(session);
    }
    Ok(out)
}

/// 删除一次考试，连同它的各科成绩。
///
/// 成绩行先显式删掉再删场次，不依赖连接上的 `foreign_keys` 开关。
pub fn delete_exam_session_impl(conn: &Connection, id: i64) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM exam_scores WHERE exam_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    let changed = tx
        .execute("DELETE FROM exam_sessions WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("记录不存在".to_string());
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_exam_session(
    state: State<'_, DbState>,
    payload: CreateExamSessionPayload,
) -> Result<ExamSessionWithScores, String> {
    with_db(&state, |conn| create_exam_session_impl(conn, payload))
}

#[tauri::command]
pub fn list_exam_sessions(state: State<'_, DbState>) -> Result<Vec<ExamSessionWithScores>, String> {
    with_db(&state, list_exam_sessions_impl)
}

#[tauri::command]
pub fn delete_exam_session(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| delete_exam_session_impl(conn, id))
}
