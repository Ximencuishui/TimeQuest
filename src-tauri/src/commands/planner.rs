use crate::error::SessionError;
use chrono::{Duration, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

/// 每日可用时段 / 每日上限在 `app_settings` 里的键。
///
/// 与前端 `src/lib/studyPlan.ts` 保持一致。
const DAILY_SLOTS_KEY: &str = "daily_slots";
const DAILY_LIMIT_KEY: &str = "daily_limit_minutes";

/// 没有设置过时用的默认三段（早上 / 下午 / 晚上各一小时）。
const DEFAULT_SLOTS: [(&str, &str); 3] = [
    ("08:00", "09:00"),
    ("14:00", "15:00"),
    ("19:00", "20:00"),
];

const DEFAULT_DAILY_LIMIT_MINUTES: i64 = 480;
const MAX_DAILY_LIMIT_MINUTES: i64 = 720;
const MIN_DAILY_LIMIT_MINUTES: i64 = 60;

/// 一次最多排 31 天，避免误填把数据库灌满。
const MAX_DAYS: i64 = 31;

/// 默认排 7 天。
const DEFAULT_DAYS: i64 = 7;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateWeekPlanInput {
    pub task_id: i64,
    /// 起始日期（`YYYY-MM-DD`），不填就是今天。
    pub start_date: Option<String>,
    /// 排几天，默认 7 天，最多 31 天。
    pub days: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerateWeekPlanResult {
    pub task_id: i64,
    /// 实际新建的排期数。
    pub created: i64,
    /// 因为时段被占用或超过每日上限而跳过的格子数。
    pub skipped: i64,
    /// 排到的最后一天（`YYYY-MM-DD`）。
    pub last_date: Option<String>,
}

/// 一个可用时段（`HH:MM`–`HH:MM`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanSlot {
    pub start: String,
    pub end: String,
}

/// 读一个设置项；没有这一行就是 `None`。
async fn read_setting(db: &SqlitePool, key: &str) -> Result<Option<String>, SessionError> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = ?1")
        .bind(key)
        .fetch_optional(db)
        .await?;
    Ok(value)
}

/// 解析每日可用时段。
///
/// 存的是 `[["08:00","09:00"], ...]`（前端 `serializeDailySlots` 的格式）。
/// 写坏了就退回默认三段。
fn parse_slots(raw: Option<&str>) -> Vec<PlanSlot> {
    let Some(raw) = raw else {
        return DEFAULT_SLOTS
            .iter()
            .map(|(start, end)| PlanSlot {
                start: (*start).to_string(),
                end: (*end).to_string(),
            })
            .collect();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return parse_slots(None);
    };
    let Some(items) = value.as_array() else {
        return parse_slots(None);
    };

    let mut slots = Vec::new();
    for item in items {
        let (start, end) = match item {
            serde_json::Value::Array(pair) if pair.len() == 2 => {
                let start = pair[0].as_str().unwrap_or_default().to_string();
                let end = pair[1].as_str().unwrap_or_default().to_string();
                (start, end)
            }
            serde_json::Value::Object(map) => {
                let start = map.get("start").and_then(|v| v.as_str()).unwrap_or_default();
                let end = map.get("end").and_then(|v| v.as_str()).unwrap_or_default();
                (start.to_string(), end.to_string())
            }
            _ => continue,
        };
        if slot_minutes(&start, &end).is_some() {
            slots.push(PlanSlot { start, end });
        }
    }
    slots
}

/// 解析每日上限（分钟），并夹在合理区间内。
fn parse_limit(raw: Option<&str>) -> i64 {
    let Some(raw) = raw else {
        return DEFAULT_DAILY_LIMIT_MINUTES;
    };
    let Ok(value) = raw.trim().parse::<i64>() else {
        return DEFAULT_DAILY_LIMIT_MINUTES;
    };
    if value <= 0 {
        return DEFAULT_DAILY_LIMIT_MINUTES;
    }
    value.clamp(MIN_DAILY_LIMIT_MINUTES, MAX_DAILY_LIMIT_MINUTES)
}

/// `HH:MM` → 当天第几分钟。解析不了返回 `None`。
fn hhmm_minutes(raw: &str) -> Option<i64> {
    let (hour, minute) = raw.trim().split_once(':')?;
    let hour: i64 = hour.trim().parse().ok()?;
    let minute: i64 = minute.trim().parse().ok()?;
    if !(0..=23).contains(&hour) || !(0..=59).contains(&minute) {
        return None;
    }
    Some(hour * 60 + minute)
}

/// 时段长度（分钟）。结束不晚于开始算无效。
fn slot_minutes(start: &str, end: &str) -> Option<i64> {
    let start = hhmm_minutes(start)?;
    let end = hhmm_minutes(end)?;
    if end <= start {
        return None;
    }
    Some(end - start)
}

/// 两个时段是否重叠（`HH:MM` 字符串比较即可）。
fn overlaps(a_start: &str, a_end: &str, b_start: &str, b_end: &str) -> bool {
    a_start < b_end && b_start < a_end
}

/// 一键排未来几天的计划（Tauri-free）。
///
/// 防呆：
/// - 只用学生自己设定的每日可用时段来排；
/// - 已经被别的排期占用的时段跳过，不会撞车；
/// - 每天累计时长不超过每日上限；
/// - 全部写在一个事务里，中途出错不留半截数据。
pub async fn generate_week_plan_impl(
    db: &SqlitePool,
    input: GenerateWeekPlanInput,
) -> Result<GenerateWeekPlanResult, SessionError> {
    let task_id = input.task_id;
    let row: Option<(i64, i64, Option<String>)> =
        sqlx::query_as("SELECT current_round, archived, deleted_at FROM tasks WHERE id = ?1")
            .bind(task_id)
            .fetch_optional(db)
            .await?;
    let Some((current_round, archived, deleted_at)) = row else {
        return Err(SessionError::TaskNotFound { task_id });
    };
    // 回收站里的任务不排期：先恢复才能继续推进。
    if deleted_at.is_some() {
        return Err(SessionError::TaskDeleted { task_id });
    }
    if archived != 0 {
        return Err(SessionError::TaskArchived { task_id });
    }

    let slots = parse_slots(read_setting(db, DAILY_SLOTS_KEY).await?.as_deref());
    if slots.is_empty() {
        return Err(SessionError::Message(
            "还没有设置每日可用时段，先去设置页填一下再排计划".into(),
        ));
    }
    let limit = parse_limit(read_setting(db, DAILY_LIMIT_KEY).await?.as_deref());

    let start_date = match input.start_date.as_deref() {
        Some(raw) if !raw.trim().is_empty() => NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d")
            .map_err(|_| SessionError::Message(format!("日期格式不对：{raw}，请用 YYYY-MM-DD")))?,
        _ => Local::now().date_naive(),
    };
    let days = input.days.unwrap_or(DEFAULT_DAYS).clamp(1, MAX_DAYS);

    let mut tx = db.begin().await?;
    let mut created = 0i64;
    let mut skipped = 0i64;
    let mut last_date: Option<String> = None;

    for offset in 0..days {
        let date = start_date + Duration::days(offset);
        let date_str = date.format("%Y-%m-%d").to_string();

        // 当天已经被占用的时段（任何任务都算），以及当天已经排了多少分钟。
        let existing: Vec<(String, String)> = sqlx::query_as(
            "SELECT start_time, end_time FROM task_sessions
             WHERE date = ?1 AND status IN ('planned', 'done')",
        )
        .bind(&date_str)
        .fetch_all(&mut *tx)
        .await?;
        let mut day_minutes: i64 = existing
            .iter()
            .filter_map(|(start, end)| slot_minutes(start, end))
            .sum();
        let mut busy = existing;

        for slot in &slots {
            let Some(slot_len) = slot_minutes(&slot.start, &slot.end) else {
                skipped += 1;
                continue;
            };
            if busy
                .iter()
                .any(|(start, end)| overlaps(start, end, &slot.start, &slot.end))
            {
                skipped += 1;
                continue;
            }
            if day_minutes + slot_len > limit {
                skipped += 1;
                continue;
            }

            sqlx::query(
                r#"INSERT INTO task_sessions (
                       task_id, date, start_time, end_time, round, status,
                       planned_units, actual_units, xp_awarded
                   ) VALUES (?1, ?2, ?3, ?4, ?5, 'planned', 1, 0, 0)"#,
            )
            .bind(task_id)
            .bind(&date_str)
            .bind(&slot.start)
            .bind(&slot.end)
            .bind(current_round)
            .execute(&mut *tx)
            .await?;

            created += 1;
            day_minutes += slot_len;
            busy.push((slot.start.clone(), slot.end.clone()));
            last_date = Some(date_str.clone());
        }
    }

    tx.commit().await?;

    Ok(GenerateWeekPlanResult {
        task_id,
        created,
        skipped,
        last_date,
    })
}

#[tauri::command]
pub async fn generate_week_plan(
    pool: State<'_, SqlitePool>,
    input: GenerateWeekPlanInput,
) -> Result<GenerateWeekPlanResult, String> {
    generate_week_plan_impl(pool.inner(), input)
        .await
        .map_err(Into::into)
}