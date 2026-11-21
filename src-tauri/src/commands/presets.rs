use crate::error::SessionError;
use chrono::Local;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use std::collections::HashMap;
use tauri::State;

/// 一次「旧时段 → 新时段」的挪动。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimeShiftChange {
    pub from_start: String,
    pub from_end: String,
    pub to_start: String,
    pub to_end: String,
}

/// 批量挪动排期的入参。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPresetTimeChangesInput {
    /// 常用时段改动前后的对应关系。
    pub changes: Vec<TimeShiftChange>,
    /// 只动这一天及以后（含当天）的排期。不填就是今天。
    pub from_date: Option<String>,
}

/// 批量挪动排期的结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PresetShiftResult {
    /// 命中旧时段、理论上要挪的排期数。
    pub matched: i64,
    /// 实际挪走的排期数。
    pub updated: i64,
    /// 挪过去会和别的排期撞车、因此保持原样的排期数。
    pub conflicts: i64,
}

/// 一次「旧时长 → 新时长」的改动。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DurationShiftChange {
    /// 原来的时长（分钟）。
    pub from_minutes: i64,
    /// 新的时长（分钟）。
    pub to_minutes: i64,
}

/// 批量改时长的入参。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPresetDurationChangesInput {
    /// 常用时长改动前后的对应关系。
    pub changes: Vec<DurationShiftChange>,
    /// 只动这一天及以后（含当天）的排期。不填就是今天。
    pub from_date: Option<String>,
}

/// 批量改时长的结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PresetDurationShiftResult {
    /// 命中旧时长、理论上要改的排期数。
    pub matched: i64,
    /// 实际改掉的排期数。
    pub updated: i64,
    /// 改过去会和别的排期撞车、因此保持原样的排期数。
    pub conflicts: i64,
}

/// 一场排期在库里最关心的四个字段。
#[derive(Debug, Clone, FromRow)]
struct ShiftCandidate {
    id: i64,
    date: String,
    start_time: String,
    end_time: String,
}

/// 一场排期在「改时长」时关心的信息。
#[derive(Debug, Clone)]
struct DurationCandidate {
    id: i64,
    /// 开始时刻（当天第几分钟）。
    start: i64,
    /// 结束时刻（当天第几分钟）。
    end: i64,
    /// 时长（分钟）。
    duration: i64,
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

/// 两个「分钟区间」是否重叠。
fn spans_overlap(a: (i64, i64), b: (i64, i64)) -> bool {
    a.0 < b.1 && b.0 < a.1
}

/// 一段时段本身是否成立：能解析，且结束晚于开始。
fn valid_range(start: &str, end: &str) -> bool {
    match (hhmm_minutes(start), hhmm_minutes(end)) {
        (Some(s), Some(e)) => e > s,
        _ => false,
    }
}

/// 把改动整理成「旧时段 → 新时段」的查表。
///
/// 同一个旧时段被指向两个不同的新时段时无法判断归属，记成歧义整段放弃：
/// 宁可不动，也不要把别人的排期挪走。
fn build_shift_map(changes: &[TimeShiftChange]) -> HashMap<(String, String), Option<(String, String)>> {
    let mut map: HashMap<(String, String), Option<(String, String)>> = HashMap::new();
    for change in changes {
        if !valid_range(&change.from_start, &change.from_end)
            || !valid_range(&change.to_start, &change.to_end)
        {
            continue;
        }
        let key = (change.from_start.clone(), change.from_end.clone());
        let target = (change.to_start.clone(), change.to_end.clone());
        match map.get(&key) {
            None => {
                map.insert(key, Some(target));
            }
            Some(Some(existing)) if *existing == target => {}
            Some(_) => {
                map.insert(key, None);
            }
        }
    }
    map
}

/// 一天里的一场排期在批量更新里的中间状态。
///
/// `payload` 是挪动之后要写回库的内容：两条路径不一样
/// ——挪时段要写起止两个时刻，改时长只写结束时刻。
struct DayEntry<T> {
    payload: Option<T>,
    /// 原时段（当天第几分钟）。
    original: (i64, i64),
    /// 打算挪到的时段（当天第几分钟）；`None` 表示这一场不打算挪。
    target: Option<(i64, i64)>,
}

/// 决定当天到底哪些场次挪得动。
///
/// 先乐观地假设所有要挪的都挪到位，再看当天会不会撞车；
/// 撞上了就把冲突的一方退回原时段（它本来就待在原处，除非它也是要挪的），
/// 然后重新检查，直到不撞车为止。
///
/// 判据是「不能制造出新的撞车」：本来就叠在一起的两场，改完还叠着不算新问题。
/// 这样「A 和 B 互换时段」这种本来合法的组合仍然能成功；
/// 而「挪过去正好压住别人原时段」会退化成保持原样——宁可不动也不造出撞车的计划。
///
/// 返回 (每一场到底挪没挪，退回原样的场次数)。
fn resolve_day_moves<T>(entries: &[DayEntry<T>]) -> (Vec<bool>, i64) {
    let mut moved: Vec<bool> = entries.iter().map(|entry| entry.target.is_some()).collect();
    let mut conflicts = 0i64;

    loop {
        let spans: Vec<(i64, i64)> = entries
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                if moved[index] {
                    entry.target.unwrap_or(entry.original)
                } else {
                    entry.original
                }
            })
            .collect();

        // 找出一对「新撞上」的场次，把它退回去。
        // entries 按开始时间排过，冲突时先退更早的那一场：晚的那场往后延，位置更空。
        let mut offender: Option<usize> = None;
        'search: for i in 0..entries.len() {
            for j in (i + 1)..entries.len() {
                if !spans_overlap(spans[i], spans[j]) {
                    continue;
                }
                // 本来就叠着的：不是这次批量更新造出来的，不算。
                if spans_overlap(entries[i].original, entries[j].original) {
                    continue;
                }
                if moved[i] {
                    offender = Some(i);
                    break 'search;
                }
                if moved[j] {
                    offender = Some(j);
                    break 'search;
                }
            }
        }

        match offender {
            Some(index) => {
                moved[index] = false;
                conflicts += 1;
            }
            None => break,
        }
    }

    (moved, conflicts)
}

/// 把常用时段的改动批量落到已排的场次上（Tauri-free）。
///
/// 规则：
/// - 只动 `planned` 的排期：`done` / `missed` 是历史，不能因为改设置就改写；
/// - 只动 `from_date`（默认今天）及以后：过去的日子改不得；
/// - 命中方式靠「旧时段完全一致」，因为排期不记录自己来自哪个常用时段；
/// - 挪过去会和当天别的排期撞车的，保持原样并计入 `conflicts`，
///   绝不允许批量更新制造出撞车的计划；
/// - 全部写在一个事务里，中途出错不留半截数据。
pub async fn apply_preset_time_changes_impl(
    db: &SqlitePool,
    input: ApplyPresetTimeChangesInput,
) -> Result<PresetShiftResult, SessionError> {
    let shift_map = build_shift_map(&input.changes);
    if shift_map.is_empty() {
        return Ok(PresetShiftResult {
            matched: 0,
            updated: 0,
            conflicts: 0,
        });
    }

    let from_date = match input.from_date.as_deref() {
        Some(raw) if !raw.trim().is_empty() => raw.trim().to_string(),
        _ => Local::now().date_naive().format("%Y-%m-%d").to_string(),
    };

    // 读和写放在同一个事务里：读到什么就写什么，中途出错整体回滚。
    let mut tx = db.begin().await?;

    let rows: Vec<ShiftCandidate> = sqlx::query_as(
        "SELECT id, date, start_time, end_time FROM task_sessions
         WHERE status = 'planned' AND date >= ?1
         ORDER BY date ASC, id ASC",
    )
    .bind(&from_date)
    .fetch_all(&mut *tx)
    .await?;

    // 先按天分组：撞车只在同一天内才有意义。
    let mut by_date: HashMap<String, Vec<ShiftCandidate>> = HashMap::new();
    let mut matched = 0i64;
    for row in rows {
        let key = (row.start_time.clone(), row.end_time.clone());
        if matches!(shift_map.get(&key), Some(Some(_))) {
            matched += 1;
        }
        by_date.entry(row.date.clone()).or_default().push(row);
    }

    let mut accepted: Vec<(i64, String, String)> = Vec::new();
    let mut conflicts = 0i64;

    for day_sessions in by_date.values() {
        // 按开始时间排一遍：撞车时优先保住更晚的那一场。
        let mut ordered: Vec<&ShiftCandidate> = day_sessions.iter().collect();
        ordered.sort_by_key(|session| (hhmm_minutes(&session.start_time).unwrap_or(0), session.id));

        let mut entries: Vec<DayEntry<(i64, String, String)>> = Vec::with_capacity(ordered.len());
        for session in &ordered {
            let original = match (
                hhmm_minutes(&session.start_time),
                hhmm_minutes(&session.end_time),
            ) {
                (Some(start), Some(end)) if end > start => (start, end),
                // 起止算不出来（跨天 / 非法）：算不出时段就无从判断撞车，保持原样。
                _ => continue,
            };
            let key = (session.start_time.clone(), session.end_time.clone());
            let (target, payload) = match shift_map.get(&key) {
                Some(Some((to_start, to_end))) => match (
                    hhmm_minutes(to_start),
                    hhmm_minutes(to_end),
                ) {
                    (Some(start), Some(end)) if end > start => (
                        Some((start, end)),
                        Some((session.id, to_start.clone(), to_end.clone())),
                    ),
                    // 目标时段本身不成立：挪不过去，保持原样。
                    _ => (None, None),
                },
                _ => (None, None),
            };
            entries.push(DayEntry {
                payload,
                original,
                target,
            });
        }

        let (moved, day_conflicts) = resolve_day_moves(&entries);
        conflicts += day_conflicts;
        for (index, entry) in entries.iter().enumerate() {
            if !moved[index] {
                continue;
            }
            if let Some((id, to_start, to_end)) = &entry.payload {
                accepted.push((*id, to_start.clone(), to_end.clone()));
            }
        }
    }

    for (id, start, end) in &accepted {
        // 再带一次 status 守卫：万一这期间这场已经被完成或改期了，就别去改写它。
        sqlx::query(
            "UPDATE task_sessions SET start_time = ?1, end_time = ?2
             WHERE id = ?3 AND status = 'planned'",
        )
        .bind(start)
        .bind(end)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok(PresetShiftResult {
        matched,
        updated: accepted.len() as i64,
        conflicts,
    })
}

/// 批量把常用时段的改动落到已排的场次上。
#[tauri::command]
pub async fn apply_preset_time_changes(
    pool: State<'_, SqlitePool>,
    input: ApplyPresetTimeChangesInput,
) -> Result<PresetShiftResult, String> {
    apply_preset_time_changes_impl(pool.inner(), input)
        .await
        .map_err(Into::into)
}

/// 一场排期的起止（当天第几分钟）。跨天或非法返回 `None`。
fn session_span(start: &str, end: &str) -> Option<(i64, i64)> {
    let start_min = hhmm_minutes(start)?;
    let end_min = hhmm_minutes(end)?;
    if end_min <= start_min {
        return None;
    }
    Some((start_min, end_min))
}

/// 当天第几分钟 → `HH:MM`。
fn format_minutes_to_hhmm(total: i64) -> String {
    let clamped = total.clamp(0, 23 * 60 + 59);
    format!("{:02}:{:02}", clamped / 60, clamped % 60)
}

/// 把改动整理成「旧时长 → 新时长」的查表。
///
/// 同一个旧时长被指向两个不同的新时长时无法判断归属，记成歧义整段放弃：
/// 宁可不动，也不要把别人的排期改坏。
fn build_duration_shift_map(changes: &[DurationShiftChange]) -> HashMap<i64, Option<i64>> {
    let mut map: HashMap<i64, Option<i64>> = HashMap::new();
    for change in changes {
        if change.from_minutes <= 0 || change.to_minutes <= 0 {
            continue;
        }
        match map.get(&change.from_minutes) {
            None => {
                map.insert(change.from_minutes, Some(change.to_minutes));
            }
            Some(Some(existing)) if *existing == change.to_minutes => {}
            Some(_) => {
                map.insert(change.from_minutes, None);
            }
        }
    }
    map
}

/// 把常用时长的改动批量落到已排的场次上（Tauri-free）。
///
/// 规则与常用时段的批量挪动同一套口径：
/// - 只动 `planned` 的排期：`done` / `missed` 是历史，不能因为改设置就改写；
/// - 只动 `from_date`（默认今天）及以后：过去的日子改不得；
/// - 命中方式靠「旧时长完全一致」，因为排期不记录自己来自哪个常用时长；
/// - 只改结束时间：开始时间是学生自己挑的，不动；
/// - 改完会和当天别的排期撞车的，保持原样并计入 `conflicts`；
/// - 全部写在一个事务里，中途出错不留半截数据。
pub async fn apply_preset_duration_changes_impl(
    db: &SqlitePool,
    input: ApplyPresetDurationChangesInput,
) -> Result<PresetDurationShiftResult, SessionError> {
    let shift_map = build_duration_shift_map(&input.changes);
    if shift_map.is_empty() {
        return Ok(PresetDurationShiftResult {
            matched: 0,
            updated: 0,
            conflicts: 0,
        });
    }

    let from_date = match input.from_date.as_deref() {
        Some(raw) if !raw.trim().is_empty() => raw.trim().to_string(),
        _ => Local::now().date_naive().format("%Y-%m-%d").to_string(),
    };

    // 读和写放在同一个事务里：读到什么就写什么，中途出错整体回滚。
    let mut tx = db.begin().await?;

    let rows: Vec<ShiftCandidate> = sqlx::query_as(
        "SELECT id, date, start_time, end_time FROM task_sessions
         WHERE status = 'planned' AND date >= ?1
         ORDER BY date ASC, id ASC",
    )
    .bind(&from_date)
    .fetch_all(&mut *tx)
    .await?;

    // 先按天分组：撞车只在同一天内才有意义。
    let mut by_date: HashMap<String, Vec<DurationCandidate>> = HashMap::new();
    let mut matched = 0i64;
    for row in rows {
        let (start, end) = match session_span(&row.start_time, &row.end_time) {
            Some(span) => span,
            // 起止算不出来（跨天 / 非法）：算不出时长也就无从改起，跳过。
            None => continue,
        };
        let duration = end - start;
        if matches!(shift_map.get(&duration), Some(Some(_))) {
            matched += 1;
        }
        by_date
            .entry(row.date.clone())
            .or_default()
            .push(DurationCandidate {
                id: row.id,
                start,
                end,
                duration,
            });
    }

    let mut accepted: Vec<(i64, String)> = Vec::new();
    let mut conflicts = 0i64;

    for day_sessions in by_date.values() {
        // 按开始时间排一遍：撞车时优先保住更晚的那一场。
        let mut ordered: Vec<&DurationCandidate> = day_sessions.iter().collect();
        ordered.sort_by_key(|candidate| (candidate.start, candidate.id));

        let mut entries: Vec<DayEntry<(i64, String)>> = Vec::with_capacity(ordered.len());
        for candidate in &ordered {
            let original = (candidate.start, candidate.end);
            let (target, payload) = match shift_map.get(&candidate.duration) {
                Some(Some(to_minutes)) => {
                    let new_end = candidate.start + to_minutes;
                    if new_end > 23 * 60 + 59 {
                        // 会跨过当天 23:59：排不进去，保持原样，计入冲突。
                        conflicts += 1;
                        (None, None)
                    } else {
                        (
                            Some((candidate.start, new_end)),
                            Some((candidate.id, format_minutes_to_hhmm(new_end))),
                        )
                    }
                }
                _ => (None, None),
            };
            entries.push(DayEntry {
                payload,
                original,
                target,
            });
        }

        let (moved, day_conflicts) = resolve_day_moves(&entries);
        conflicts += day_conflicts;
        for (index, entry) in entries.iter().enumerate() {
            if !moved[index] {
                continue;
            }
            if let Some((id, end_time)) = &entry.payload {
                accepted.push((*id, end_time.clone()));
            }
        }
    }

    for (id, end_time) in &accepted {
        // 再带一次 status 守卫：万一这期间这场已经被完成或改期了，就别去改写它。
        sqlx::query("UPDATE task_sessions SET end_time = ?1 WHERE id = ?2 AND status = 'planned'")
            .bind(end_time)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    Ok(PresetDurationShiftResult {
        matched,
        updated: accepted.len() as i64,
        conflicts,
    })
}

/// 批量把常用时长的改动落到已排的场次上。
#[tauri::command]
pub async fn apply_preset_duration_changes(
    pool: State<'_, SqlitePool>,
    input: ApplyPresetDurationChangesInput,
) -> Result<PresetDurationShiftResult, String> {
    apply_preset_duration_changes_impl(pool.inner(), input)
        .await
        .map_err(Into::into)
}