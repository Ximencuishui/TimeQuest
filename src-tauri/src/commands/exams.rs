use crate::db::{with_db, DbState};
use crate::models::{CreateExamRecordPayload, ExamRecord};
use chrono::NaiveDate;
use rusqlite::{params, Connection};
use tauri::State;

const SELECT_RECORD: &str = "SELECT id, exam_name, exam_date, chinese_score, math_score, english_score, physics_score, chemistry_score, biology_score, created_at FROM exam_records";

fn map_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExamRecord> {
    Ok(ExamRecord {
        id: row.get(0)?,
        exam_name: row.get(1)?,
        exam_date: row.get(2)?,
        chinese_score: row.get(3)?,
        math_score: row.get(4)?,
        english_score: row.get(5)?,
        physics_score: row.get(6)?,
        chemistry_score: row.get(7)?,
        biology_score: row.get(8)?,
        created_at: row.get(9)?,
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

fn reject_negative(label: &str, score: Option<i64>) -> Result<(), String> {
    if score.is_some_and(|value| value < 0) {
        return Err(format!("{label}成绩不能为负数"));
    }
    Ok(())
}

pub fn create_exam_record_impl(
    conn: &Connection,
    payload: CreateExamRecordPayload,
) -> Result<ExamRecord, String> {
    let exam_name = payload.exam_name.trim().to_string();
    if exam_name.is_empty() {
        return Err("请填写考试名称".to_string());
    }
    let exam_date = normalize_exam_date(&payload.exam_date)?;
    let scores = [
        ("语文", payload.chinese_score),
        ("数学", payload.math_score),
        ("英语", payload.english_score),
        ("物理", payload.physics_score),
        ("化学", payload.chemistry_score),
        ("生物", payload.biology_score),
    ];
    for (label, score) in &scores {
        reject_negative(label, *score)?;
    }
    if scores.iter().all(|(_, score)| score.is_none()) {
        return Err("请至少填写一科成绩".to_string());
    }
    conn.execute(
        r#"INSERT INTO exam_records (
             exam_name, exam_date, chinese_score, math_score, english_score,
             physics_score, chemistry_score, biology_score
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
        params![
            exam_name,
            exam_date,
            payload.chinese_score,
            payload.math_score,
            payload.english_score,
            payload.physics_score,
            payload.chemistry_score,
            payload.biology_score,
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        &format!("{SELECT_RECORD} WHERE id = ?1"),
        params![id],
        map_record,
    )
    .map_err(|e| e.to_string())
}

pub fn list_exam_records_impl(conn: &Connection) -> Result<Vec<ExamRecord>, String> {
    let mut stmt = conn
        .prepare(&format!("{SELECT_RECORD} ORDER BY exam_date DESC, id DESC"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_record)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn delete_exam_record_impl(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM exam_records WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("记录不存在".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn create_exam_record(
    state: State<'_, DbState>,
    payload: CreateExamRecordPayload,
) -> Result<ExamRecord, String> {
    with_db(&state, |conn| create_exam_record_impl(conn, payload))
}

#[tauri::command]
pub fn list_exam_records(state: State<'_, DbState>) -> Result<Vec<ExamRecord>, String> {
    with_db(&state, list_exam_records_impl)
}

#[tauri::command]
pub fn delete_exam_record(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| delete_exam_record_impl(conn, id))
}
