//! 赛道（学习方向）。
//!
//! 4.0 之前产品只有「高考」一种形态，所有地方都写死六科。
//! 现在「高考」只是 `tracks` 表里的一条记录，换赛道就是换一套科目 + 一套目标。
//!
//! 赛道本身不携带学科常量，具体的科目与语料由赛道包（P2-1）播种。

use crate::db::{with_db, DbState};
use crate::models::{Track, UpsertTrackPayload};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

/// 赛道类型白名单。
pub const TRACK_KINDS: [&str; 3] = ["exam", "skill", "course"];
/// 计分方式白名单。
pub const TRACK_SCORE_MODES: [&str; 3] = ["total", "per_subject", "band"];

pub const TRACK_KIND_EXAM: &str = "exam";
pub const TRACK_SCORE_MODE_TOTAL: &str = "total";
/// 默认赛道名称。老库升级后先落在它身上。
pub const DEFAULT_TRACK_NAME: &str = "高考";

/// 默认赛道（高考）的种子科目：key、显示名、满分、默认目标。
///
/// 语数英满分 150，物化生各 100（合计 750）；目标分沿用老口径，不强推满分。
/// 赛道本身不携带学科常量——这里只是「高考」这条赛道出厂时带的六科。
/// 别的赛道由赛道包（P2-1）提供自己的科目。
pub const DEFAULT_TRACK_SUBJECTS: [(&str, &str, f64, f64); 6] = [
    ("chinese", "语文", 150.0, 120.0),
    ("math", "数学", 150.0, 130.0),
    ("english", "英语", 150.0, 120.0),
    ("physics", "物理", 100.0, 80.0),
    ("chemistry", "化学", 100.0, 80.0),
    ("biology", "生物", 100.0, 80.0),
];

const SELECT_TRACK: &str =
    "SELECT id, name, kind, score_mode, is_primary, color, created_at FROM tracks";

fn map_track(row: &rusqlite::Row<'_>) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: row.get(2)?,
        score_mode: row.get(3)?,
        is_primary: row.get::<_, i64>(4)? != 0,
        color: row.get(5)?,
        created_at: row.get(6)?,
    })
}

/// 全部赛道。主赛道排最前，其余按创建顺序。
pub fn list_tracks_impl(conn: &Connection) -> Result<Vec<Track>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "{SELECT_TRACK} ORDER BY is_primary DESC, id ASC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_track)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 按 id 找赛道。
pub fn track_by_id(conn: &Connection, id: i64) -> Result<Option<Track>, String> {
    conn.query_row(
        &format!("{SELECT_TRACK} WHERE id = ?1"),
        params![id],
        map_track,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// 当前主赛道。没有主赛道就退回第一条。
pub fn primary_track(conn: &Connection) -> Result<Option<Track>, String> {
    let rows = list_tracks_impl(conn)?;
    let primary = rows.iter().find(|track| track.is_primary);
    Ok(primary.cloned().or_else(|| rows.into_iter().next()))
}

/// 新建或修改一条赛道。
///
/// `is_primary = true` 时，同一事务里把其它赛道降为普通赛道 —— 主赛道永远只有一个。
pub fn upsert_track_impl(
    conn: &Connection,
    payload: UpsertTrackPayload,
) -> Result<Track, String> {
    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Err("请填写赛道名称".to_string());
    }
    let kind = payload
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(TRACK_KIND_EXAM)
        .to_string();
    if !TRACK_KINDS.contains(&kind.as_str()) {
        return Err("赛道类型不合法".to_string());
    }
    let score_mode = payload
        .score_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(TRACK_SCORE_MODE_TOTAL)
        .to_string();
    if !TRACK_SCORE_MODES.contains(&score_mode.as_str()) {
        return Err("计分方式不合法".to_string());
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let id = match payload.id {
        Some(id) if id > 0 => {
            let exists: Option<i64> = tx
                .query_row("SELECT id FROM tracks WHERE id = ?1", params![id], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(|e| e.to_string())?;
            if exists.is_none() {
                return Err("赛道不存在".to_string());
            }
            tx.execute(
                r#"UPDATE tracks
                      SET name = ?1,
                          kind = ?2,
                          score_mode = ?3,
                          color = ?4
                    WHERE id = ?5"#,
                params![name, kind, score_mode, payload.color, id],
            )
            .map_err(|e| e.to_string())?;
            id
        }
        _ => {
            tx.execute(
                r#"INSERT INTO tracks (name, kind, score_mode, color)
                   VALUES (?1, ?2, ?3, ?4)"#,
                params![name, kind, score_mode, payload.color],
            )
            .map_err(|e| e.to_string())?;
            tx.last_insert_rowid()
        }
    };

    if payload.is_primary.unwrap_or(false) {
        tx.execute(
            "UPDATE tracks SET is_primary = CASE WHEN id = ?1 THEN 1 ELSE 0 END",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    }

    let track = tx
        .query_row(&format!("{SELECT_TRACK} WHERE id = ?1"), params![id], map_track)
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(track)
}

/// 删除一条赛道。它下面的科目与目标一起处理，不留悬空引用。
pub fn remove_track_impl(conn: &Connection, id: i64) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    // 挂在这条赛道下的科目与目标先解除归属，不删历史成绩。
    // 顺序不能反：`subjects.track_id` 有外键，先删赛道会直接违反约束。
    tx.execute(
        "UPDATE subjects SET track_id = NULL WHERE track_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE goals SET track_id = NULL WHERE track_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE exam_sessions SET track_id = NULL WHERE track_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    let changed = tx
        .execute("DELETE FROM tracks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("赛道不存在".to_string());
    }
    // 主赛道被删了，剩下的第一条顶上。
    let primaries: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM tracks WHERE is_primary = 1",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if primaries == 0 {
        tx.execute(
            r#"UPDATE tracks SET is_primary = 1
                WHERE id = (SELECT id FROM tracks ORDER BY id ASC LIMIT 1)"#,
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 库里一条赛道都没有时补一条默认赛道 + 六科目 + 主目标（幂等）。
///
/// 已有赛道就沿用：既不重复插赛道，也不覆盖用户改过的科目。
pub fn seed_default_track_impl(conn: &Connection) -> Result<Track, String> {
    let existing = list_tracks_impl(conn)?;
    let track = match existing.iter().find(|track| track.is_primary) {
        Some(track) => track.clone(),
        None => match existing.first() {
            Some(track) => track.clone(),
            None => upsert_track_impl(
                conn,
                UpsertTrackPayload {
                    id: None,
                    name: DEFAULT_TRACK_NAME.to_string(),
                    kind: Some(TRACK_KIND_EXAM.to_string()),
                    score_mode: Some(TRACK_SCORE_MODE_TOTAL.to_string()),
                    is_primary: Some(true),
                    color: None,
                },
            )?,
        },
    };
    seed_track_subjects(conn, &track)?;
    crate::commands::goals::seed_default_goal_impl(conn)?;
    Ok(track)
}

/// 给赛道补齐出厂科目。已有的按 key 跳过，不改用户改过的满分与目标。
///
/// 导入旧备份时也可能用到：老备份不带科目字典，库里一科都没有时要补齐。
pub(crate) fn seed_track_subjects(conn: &Connection, track: &Track) -> Result<(), String> {
    for (index, (key, label, full_mark, goal)) in DEFAULT_TRACK_SUBJECTS.iter().enumerate() {
        // 用户主动删过的科目不再补回来：删了就是删了，下次启动也一样。
        let removed: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM removed_subjects WHERE key = ?1)",
                params![key],
                |r| r.get::<_, i64>(0),
            )
            .map(|value| value != 0)
            .map_err(|e| e.to_string())?;
        if removed {
            continue;
        }
        let existing: Option<(i64, Option<i64>)> = conn
            .query_row(
                "SELECT id, track_id FROM subjects WHERE key = ?1",
                params![key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((id, track_id)) = existing {
            // 科目还在但没挂赛道（导入时归属被清空过）：补挂回当前赛道。
            // 播种是按 key 跳过的，不补的话它会一直当孤儿，重启也救不回来。
            if track_id.is_none() {
                conn.execute(
                    "UPDATE subjects SET track_id = ?1 WHERE id = ?2 AND track_id IS NULL",
                    params![track.id, id],
                )
                .map_err(|e| e.to_string())?;
            }
            continue;
        }
        conn.execute(
            "INSERT INTO subjects (key, label, full_mark, goal, unit, order_index, track_id)
             VALUES (?1, ?2, ?3, ?4, '分', ?5, ?6)",
            params![key, label, full_mark, goal, index as i64, track.id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_tracks(state: State<'_, DbState>) -> Result<Vec<Track>, String> {
    with_db(&state, list_tracks_impl)
}

#[tauri::command]
pub fn upsert_track(
    state: State<'_, DbState>,
    payload: UpsertTrackPayload,
) -> Result<Track, String> {
    with_db(&state, |conn| upsert_track_impl(conn, payload))
}

#[tauri::command]
pub fn remove_track(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| remove_track_impl(conn, id))
}
