use crate::commands::mistakes::{
    normalize_graph_link, normalize_reason_with, normalize_subject,
};
use crate::commands::notes::{normalize_color, normalize_note_date};
use crate::commands::profile::{upsert_user_profile_row, user_profile_from_export};
use crate::commands::subjects::subject_id_for_key;
use crate::commands::tracks::{
    DEFAULT_TRACK_NAME, TRACK_KIND_EXAM, TRACK_SCORE_MODE_TOTAL,
};
use crate::db::{db_path, with_db, DbState};
use crate::models::{SubjectTargets, UserProfile};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use tauri::{AppHandle, State};

use crate::db::AppPrefs;

/// 老备份（3.x）里一行六科的成绩，展开成成绩行时用的对应关系。
const LEGACY_SCORE_FIELDS: [(&str, &str); 6] = [
    ("chinese_score", "chinese"),
    ("math_score", "math"),
    ("english_score", "english"),
    ("physics_score", "physics"),
    ("chemistry_score", "chemistry"),
    ("biology_score", "biology"),
];

/// 备份里的赛道 id 映射到新库。备份没带赛道时（v1）落到主赛道上。
fn resolve_track_id(
    track_map: &HashMap<i64, i64>,
    fallback: Option<i64>,
    raw: Option<i64>,
) -> Option<i64> {
    raw.and_then(|id| track_map.get(&id).copied()).or(fallback)
}

/// Reject `actual_logs.session_id` that is non-null but missing from payload `task_sessions`.
/// `session_id: null` (manual log) is allowed. Runs before any write so the Err names the log.
fn validate_actual_log_session_refs(data: &Value) -> Result<(), String> {
    let session_ids: HashSet<i64> = data
        .get("task_sessions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.get("id").and_then(|v| v.as_i64()))
                .collect()
        })
        .unwrap_or_default();

    if let Some(arr) = data.get("actual_logs").and_then(|v| v.as_array()) {
        for l in arr {
            let Some(sid) = l.get("session_id").and_then(|v| v.as_i64()) else {
                continue; // null / missing → manual log
            };
            if !session_ids.contains(&sid) {
                let log_id = l
                    .get("id")
                    .and_then(|v| v.as_i64())
                    .map(|id| id.to_string())
                    .unwrap_or_else(|| "?".into());
                return Err(format!(
                    "actual_logs id={log_id} has dangling session_id={sid} (not in task_sessions)"
                ));
            }
        }
    }
    Ok(())
}

/// Reject `user_achievements.achievement_id` missing from catalog table `achievements`.
/// Needed because import uses `INSERT OR IGNORE`, which would also swallow FK violations.
fn validate_user_achievement_refs(conn: &Connection, data: &Value) -> Result<(), String> {
    let known: HashSet<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM achievements")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<HashSet<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    if let Some(arr) = data.get("user_achievements").and_then(|v| v.as_array()) {
        for a in arr {
            let id = a
                .get("achievement_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !known.contains(id) {
                return Err(format!(
                    "user_achievements has dangling achievement_id={id:?} (not in achievements)"
                ));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_db_path(app: AppHandle) -> Result<String, String> {
    Ok(db_path(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_close_to_tray(prefs: State<'_, AppPrefs>, enabled: bool) -> Result<(), String> {
    prefs.set_close_to_tray(enabled);
    Ok(())
}

/// Export all user tables to a pretty JSON string. Pure (no Tauri) for tests.
pub fn export_json_impl(conn: &Connection) -> Result<String, String> {
    let tasks: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT id, title, type, subject, textbook, unit_name, total_units, total_rounds, current_round, color, archived, created_at, deleted_at, is_mock FROM tasks")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "title": r.get::<_, String>(1)?,
                    "type": r.get::<_, String>(2)?,
                    "subject": r.get::<_, Option<String>>(3)?,
                    "textbook": r.get::<_, Option<String>>(4)?,
                    "unit_name": r.get::<_, String>(5)?,
                    "total_units": r.get::<_, Option<i64>>(6)?,
                    "total_rounds": r.get::<_, i64>(7)?,
                    "current_round": r.get::<_, i64>(8)?,
                    "color": r.get::<_, Option<String>>(9)?,
                    "archived": r.get::<_, i64>(10)?,
                    "created_at": r.get::<_, String>(11)?,
                    "deleted_at": r.get::<_, Option<String>>(12)?,
                    "is_mock": r.get::<_, i64>(13)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let sessions: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT id, task_id, date, start_time, end_time, round, status, planned_units, actual_units, self_rating, self_note, rescheduled_to, xp_awarded, created_at, is_mock FROM task_sessions")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "task_id": r.get::<_, i64>(1)?,
                    "date": r.get::<_, String>(2)?,
                    "start_time": r.get::<_, String>(3)?,
                    "end_time": r.get::<_, String>(4)?,
                    "round": r.get::<_, i64>(5)?,
                    "status": r.get::<_, String>(6)?,
                    "planned_units": r.get::<_, i64>(7)?,
                    "actual_units": r.get::<_, i64>(8)?,
                    "self_rating": r.get::<_, Option<i64>>(9)?,
                    "self_note": r.get::<_, Option<String>>(10)?,
                    "rescheduled_to": r.get::<_, Option<i64>>(11)?,
                    "xp_awarded": r.get::<_, i64>(12)?,
                    "created_at": r.get::<_, String>(13)?,
                    "is_mock": r.get::<_, i64>(14)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let logs: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT id, date, start_at, end_at, duration_min, subject, method, tag_type, session_id, note, created_at FROM actual_logs")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "date": r.get::<_, String>(1)?,
                    "start_at": r.get::<_, Option<String>>(2)?,
                    "end_at": r.get::<_, Option<String>>(3)?,
                    "duration_min": r.get::<_, i64>(4)?,
                    "subject": r.get::<_, Option<String>>(5)?,
                    "method": r.get::<_, Option<String>>(6)?,
                    "tag_type": r.get::<_, String>(7)?,
                    "session_id": r.get::<_, Option<i64>>(8)?,
                    "note": r.get::<_, Option<String>>(9)?,
                    "created_at": r.get::<_, String>(10)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let notes: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT id, content, color, pinned, note_date, created_at, updated_at FROM notes")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "content": r.get::<_, String>(1)?,
                    "color": r.get::<_, String>(2)?,
                    "pinned": r.get::<_, i64>(3)?,
                    "note_date": r.get::<_, Option<String>>(4)?,
                    "created_at": r.get::<_, String>(5)?,
                    "updated_at": r.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let mistakes: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT id, subject, title, reason, correct_note, is_mastered, created_at, updated_at, graph_topic_id, graph_subject, graph_topic_name FROM mistakes")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "subject": r.get::<_, String>(1)?,
                    "title": r.get::<_, String>(2)?,
                    "reason": r.get::<_, String>(3)?,
                    "correct_note": r.get::<_, String>(4)?,
                    "is_mastered": r.get::<_, i64>(5)?,
                    "created_at": r.get::<_, String>(6)?,
                    "updated_at": r.get::<_, String>(7)?,
                    "graph_topic_id": r.get::<_, Option<String>>(8)?,
                    "graph_subject": r.get::<_, Option<String>>(9)?,
                    "graph_topic_name": r.get::<_, Option<String>>(10)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    // Singleton: missing id=1 means corruption — fail loud, never omit user_stats.
    let stats: Value = conn
        .query_row(
            "SELECT total_xp, current_level, current_streak, longest_streak, last_done_date FROM user_stats WHERE id=1",
            [],
            |r| {
                Ok(json!({
                    "total_xp": r.get::<_, i64>(0)?,
                    "current_level": r.get::<_, i64>(1)?,
                    "current_streak": r.get::<_, i64>(2)?,
                    "longest_streak": r.get::<_, i64>(3)?,
                    "last_done_date": r.get::<_, Option<String>>(4)?,
                }))
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                "user_stats 缺失，数据损坏（需要 id=1 单例行）".to_string()
            }
            other => other.to_string(),
        })?;

    let achievements: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT achievement_id, unlocked_at FROM user_achievements")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "achievement_id": r.get::<_, String>(0)?,
                    "unlocked_at": r.get::<_, String>(1)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let app_settings: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT key, value, updated_at FROM app_settings ORDER BY key")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "key": r.get::<_, String>(0)?,
                    "value": r.get::<_, String>(1)?,
                    "updated_at": r.get::<_, String>(2)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let user_profile: Value = {
        let (avatar, grade, region, total_target, targets, updated_at): (
            Option<String>,
            String,
            String,
            Option<i64>,
            String,
            String,
        ) = conn
            .query_row(
                "SELECT avatar, grade, region, total_target, subject_targets, updated_at
                 FROM user_profile WHERE id = 1",
                [],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                },
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    "user_profile 缺失，数据损坏（需要 id=1 单例行）".to_string()
                }
                other => other.to_string(),
            })?;
        // `subject_targets` 是 3.x 的兼容列：4.0 起各科目标在 `subjects` 表里。
        // 这里仍然导出，并用科目字典里的真实目标覆盖，老版本读这个备份时才不会丢各科目标。
        let mut subject_targets: Value = serde_json::from_str(&targets).unwrap_or_else(|_| {
            serde_json::to_value(SubjectTargets::default()).expect("default subject targets")
        });
        if let Some(map) = subject_targets.as_object_mut() {
            let mut stmt = conn
                .prepare("SELECT key, goal FROM subjects WHERE goal IS NOT NULL ORDER BY order_index")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            for (key, goal) in rows {
                map.insert(key, json!(goal.round() as i64));
            }
        }
        json!({
            "avatar": avatar,
            "grade": grade,
            "region": region,
            "total_target": total_target,
            "subject_targets": subject_targets,
            "updated_at": updated_at,
        })
    };

    let imported_textbooks: Vec<Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, subject, version, volume, outline_json, created_at, updated_at
                 FROM imported_textbooks ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "subject": r.get::<_, String>(1)?,
                    "version": r.get::<_, String>(2)?,
                    "volume": r.get::<_, String>(3)?,
                    "outline_json": r.get::<_, String>(4)?,
                    "created_at": r.get::<_, String>(5)?,
                    "updated_at": r.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    // 赛道字典。科目 / 目标 / 成绩场次都挂在赛道下面，导出时一起带走。
    let tracks: Vec<Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, kind, score_mode, is_primary, color, created_at FROM tracks ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "name": r.get::<_, String>(1)?,
                    "kind": r.get::<_, String>(2)?,
                    "scoreMode": r.get::<_, String>(3)?,
                    "isPrimary": r.get::<_, i64>(4)? != 0,
                    "color": r.get::<_, Option<String>>(5)?,
                    "createdAt": r.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    // 科目字典。成绩行靠 subject_id 关联科目，导出时带上它才不会被拆散。
    let subjects: Vec<Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, key, label, full_mark, goal, unit, order_index, track_id FROM subjects ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "key": r.get::<_, String>(1)?,
                    "label": r.get::<_, String>(2)?,
                    "fullMark": r.get::<_, Option<f64>>(3)?,
                    "goal": r.get::<_, Option<f64>>(4)?,
                    "unit": r.get::<_, Option<String>>(5)?,
                    "orderIndex": r.get::<_, i64>(6)?,
                    "trackId": r.get::<_, Option<i64>>(7)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    // 4.0 起成绩是「场次 + 成绩行」两张表。老的 exam_records 只读留档，
    // 导出时留一个空数组，旧版读取器不会报错。
    let exam_sessions: Vec<Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, track_id, name, date, is_mock, created_at FROM exam_sessions ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "trackId": r.get::<_, Option<i64>>(1)?,
                    "name": r.get::<_, String>(2)?,
                    "date": r.get::<_, String>(3)?,
                    "isMock": r.get::<_, i64>(4)? != 0,
                    "createdAt": r.get::<_, String>(5)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let exam_scores: Vec<Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT es.id, es.exam_id, s.key, es.score
                 FROM exam_scores es JOIN subjects s ON s.id = es.subject_id
                 ORDER BY es.id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "examId": r.get::<_, i64>(1)?,
                    "subjectKey": r.get::<_, String>(2)?,
                    "score": r.get::<_, Option<f64>>(3)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    // 用户删过的科目：没有这笔记录，换机导入后下次启动科目就回来了。
    let removed_subjects: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT key, removed_at FROM removed_subjects ORDER BY key")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "key": r.get::<_, String>(0)?,
                    "removedAt": r.get::<_, String>(1)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let task_knowledge_points: Vec<Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, section_name, name, is_mastered, position, created_at,
                        graph_topic_id, graph_subject
                 FROM task_knowledge_points ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "task_id": r.get::<_, i64>(1)?,
                    "section_name": r.get::<_, String>(2)?,
                    "name": r.get::<_, String>(3)?,
                    "is_mastered": r.get::<_, i64>(4)?,
                    "position": r.get::<_, i64>(5)?,
                    "created_at": r.get::<_, String>(6)?,
                    "graph_topic_id": r.get::<_, Option<String>>(7)?,
                    "graph_subject": r.get::<_, Option<String>>(8)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let goals: Vec<Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, track_id, name, date, kind, is_primary, target_score, created_at
                 FROM goals ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "trackId": r.get::<_, Option<i64>>(1)?,
                    "name": r.get::<_, String>(2)?,
                    "date": r.get::<_, String>(3)?,
                    "kind": r.get::<_, String>(4)?,
                    "isPrimary": r.get::<_, i64>(5)? != 0,
                    "targetScore": r.get::<_, Option<f64>>(6)?,
                    "createdAt": r.get::<_, String>(7)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let payload = json!({
        "version": 2,
        "exported_at": chrono::Local::now().to_rfc3339(),
        "tasks": tasks,
        "task_sessions": sessions,
        "actual_logs": logs,
        "notes": notes,
        "mistakes": mistakes,
        "user_stats": stats,
        "user_achievements": achievements,
        "user_profile": user_profile,
        "app_settings": app_settings,
        "imported_textbooks": imported_textbooks,
        "tracks": tracks,
        "subjects": subjects,
        "exam_sessions": exam_sessions,
        "exam_scores": exam_scores,
        "exam_records": Vec::<Value>::new(),
        "task_knowledge_points": task_knowledge_points,
        "goals": goals,
        "removed_subjects": removed_subjects,
    });
    serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())
}

/// Import payload into `conn` inside a single transaction (clears user tables first).
/// Pure (no Tauri / no file backup) for tests.
pub fn import_json_impl(conn: &Connection, json: &str) -> Result<(), String> {
    let data: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    // Prefer A: reject dangling session_id before clearing / inserting (clearer Err than FK).
    validate_actual_log_session_refs(&data)?;
    // INSERT OR IGNORE would swallow FK misses on achievement_id; reject up front like logs.
    validate_user_achievement_refs(conn, &data)?;

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute_batch(
        r#"
            DELETE FROM user_achievements;
            DELETE FROM actual_logs;
            DELETE FROM task_sessions;
            DELETE FROM notes;
            DELETE FROM mistakes;
            DELETE FROM task_knowledge_points;
            DELETE FROM tasks;
            DELETE FROM app_settings;
            DELETE FROM imported_textbooks;
            DELETE FROM exam_scores;
            DELETE FROM exam_sessions;
            DELETE FROM exam_records;
            DELETE FROM goals;
            DELETE FROM removed_subjects;
            UPDATE subjects SET track_id = NULL;
            DELETE FROM tracks;
            UPDATE user_stats SET total_xp=0, current_level=1, current_streak=0, longest_streak=0, last_done_date=NULL WHERE id=1;
            "#,
    )
    .map_err(|e| e.to_string())?;

    // 设置先回来：错因白名单、学习方式都存在 `app_settings` 里，
    // 导入错题时要按同一份白名单归一，前后端口径不能分叉。
    if let Some(arr) = data.get("app_settings").and_then(|v| v.as_array()) {
        for row in arr {
            tx.execute(
                r#"INSERT INTO app_settings (key, value, updated_at)
                   VALUES (?1, ?2, COALESCE(?3, datetime('now')))"#,
                params![
                    row.get("key").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("value").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("updated_at").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // 赛道：按备份重建。备份里的 track id 是来源库的，新库不一定对得上，
    // 所以建一张「旧 id → 新 id」映射表，后面科目 / 目标 / 成绩场次都靠它挂回去。
    let mut track_map: HashMap<i64, i64> = HashMap::new();
    if let Some(arr) = data.get("tracks").and_then(|v| v.as_array()) {
        for row in arr {
            let Some(old_id) = row.get("id").and_then(|v| v.as_i64()) else {
                continue;
            };
            let name = row
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if name.is_empty() {
                continue;
            }
            let kind = row
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or(TRACK_KIND_EXAM)
                .to_string();
            let score_mode = row
                .get("scoreMode")
                .or_else(|| row.get("score_mode"))
                .and_then(|v| v.as_str())
                .unwrap_or(TRACK_SCORE_MODE_TOTAL)
                .to_string();
            tx.execute(
                r#"INSERT INTO tracks (name, kind, score_mode, is_primary, color, created_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, datetime('now','localtime')))"#,
                params![
                    name,
                    kind,
                    score_mode,
                    row.get("isPrimary")
                        .or_else(|| row.get("is_primary"))
                        .and_then(|v| v.as_i64().or_else(|| v.as_bool().map(i64::from)))
                        .unwrap_or(0),
                    row.get("color").and_then(|v| v.as_str()),
                    row.get("createdAt")
                        .or_else(|| row.get("created_at"))
                        .and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
            track_map.insert(old_id, tx.last_insert_rowid());
        }
    }

    // 库里至少要有一条主赛道。v1 旧备份没有赛道，这里补一条默认的。
    let mut fallback_track: Option<i64> = tx
        .query_row(
            "SELECT id FROM tracks WHERE is_primary = 1 ORDER BY id ASC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if fallback_track.is_none() {
        let first: Option<i64> = tx
            .query_row(
                "SELECT id FROM tracks ORDER BY id ASC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        match first {
            Some(id) => {
                tx.execute("UPDATE tracks SET is_primary = 1 WHERE id = ?1", params![id])
                    .map_err(|e| e.to_string())?;
                fallback_track = Some(id);
            }
            None => {
                tx.execute(
                    "INSERT INTO tracks (name, kind, score_mode, is_primary) VALUES (?1, ?2, ?3, 1)",
                    params![DEFAULT_TRACK_NAME, TRACK_KIND_EXAM, TRACK_SCORE_MODE_TOTAL],
                )
                .map_err(|e| e.to_string())?;
                fallback_track = Some(tx.last_insert_rowid());
            }
        }
    }

    // 老备份（v1 / 3.x）不带赛道归属：科目一律挂到主赛道。
    // 不然导入后按赛道筛选一科都看不到（track_id 为 NULL 不匹配任何赛道），
    // 而播种自愈按 key 跳过，这些科目会永远当孤儿。
    tx.execute(
        "UPDATE subjects SET track_id = ?1 WHERE track_id IS NULL",
        params![fallback_track],
    )
    .map_err(|e| e.to_string())?;

    if let Some(arr) = data.get("tasks").and_then(|v| v.as_array()) {
        for t in arr {
            tx.execute(
                r#"INSERT INTO tasks (id, title, type, subject, textbook, unit_name, total_units, total_rounds, current_round, color, archived, created_at, deleted_at, is_mock)
                       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,COALESCE(?12, datetime('now','localtime')),?13,?14)"#,
                params![
                    t.get("id").and_then(|v| v.as_i64()),
                    t.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                    t.get("type").and_then(|v| v.as_str()).unwrap_or("side"),
                    t.get("subject").and_then(|v| v.as_str()),
                    t.get("textbook").and_then(|v| v.as_str()),
                    t.get("unit_name").and_then(|v| v.as_str()).unwrap_or("课"),
                    t.get("total_units").and_then(|v| v.as_i64()),
                    t.get("total_rounds").and_then(|v| v.as_i64()).unwrap_or(1),
                    t.get("current_round").and_then(|v| v.as_i64()).unwrap_or(1),
                    t.get("color").and_then(|v| v.as_str()),
                    t.get("archived").and_then(|v| v.as_i64()).unwrap_or(0),
                    t.get("created_at").and_then(|v| v.as_str()),
                    // 回收站状态要跟着备份走，否则导入后任务就「活」了。
                    t.get("deleted_at").and_then(|v| v.as_str()),
                    t.get("is_mock").and_then(|v| v.as_i64()).unwrap_or(0),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // Phase 1: insert sessions with rescheduled_to = NULL so self-FK never points
    // at a row that is not yet present (export order is not topological).
    if let Some(arr) = data.get("task_sessions").and_then(|v| v.as_array()) {
        for s in arr {
            tx.execute(
                r#"INSERT INTO task_sessions (id, task_id, date, start_time, end_time, round, status, planned_units, actual_units, self_rating, self_note, rescheduled_to, xp_awarded, created_at, is_mock)
                       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,NULL,?12,COALESCE(?13, datetime('now','localtime')),?14)"#,
                params![
                    s.get("id").and_then(|v| v.as_i64()),
                    s.get("task_id").and_then(|v| v.as_i64()).unwrap_or(0),
                    s.get("date").and_then(|v| v.as_str()).unwrap_or(""),
                    s.get("start_time").and_then(|v| v.as_str()).unwrap_or("09:00"),
                    s.get("end_time").and_then(|v| v.as_str()).unwrap_or("10:00"),
                    s.get("round").and_then(|v| v.as_i64()).unwrap_or(1),
                    s.get("status").and_then(|v| v.as_str()).unwrap_or("planned"),
                    s.get("planned_units").and_then(|v| v.as_i64()).unwrap_or(0),
                    s.get("actual_units").and_then(|v| v.as_i64()).unwrap_or(0),
                    s.get("self_rating").and_then(|v| v.as_i64()),
                    s.get("self_note").and_then(|v| v.as_str()),
                    s.get("xp_awarded").and_then(|v| v.as_i64()).unwrap_or(0),
                    s.get("created_at").and_then(|v| v.as_str()),
                    s.get("is_mock").and_then(|v| v.as_i64()).unwrap_or(0),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        // Phase 2: apply rescheduled_to after all session rows exist.
        for s in arr {
            let Some(id) = s.get("id").and_then(|v| v.as_i64()) else {
                continue;
            };
            let target = s.get("rescheduled_to").and_then(|v| v.as_i64());
            if target.is_some() {
                tx.execute(
                    "UPDATE task_sessions SET rescheduled_to = ?1 WHERE id = ?2",
                    params![target, id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    if let Some(arr) = data.get("actual_logs").and_then(|v| v.as_array()) {
        for l in arr {
            tx.execute(
                r#"INSERT INTO actual_logs (id, date, start_at, end_at, duration_min, subject, method, tag_type, session_id, note, created_at)
                       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,COALESCE(?11, datetime('now','localtime')))"#,
                params![
                    l.get("id").and_then(|v| v.as_i64()),
                    l.get("date").and_then(|v| v.as_str()).unwrap_or(""),
                    l.get("start_at").and_then(|v| v.as_str()),
                    l.get("end_at").and_then(|v| v.as_str()),
                    l.get("duration_min").and_then(|v| v.as_i64()).unwrap_or(0),
                    l.get("subject").and_then(|v| v.as_str()),
                    l.get("method").and_then(|v| v.as_str()),
                    l.get("tag_type").and_then(|v| v.as_str()).unwrap_or("study"),
                    l.get("session_id").and_then(|v| v.as_i64()),
                    l.get("note").and_then(|v| v.as_str()),
                    l.get("created_at").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if let Some(arr) = data.get("notes").and_then(|v| v.as_array()) {
        for n in arr {
            tx.execute(
                r#"INSERT INTO notes (id, content, color, pinned, note_date, created_at, updated_at)
                       VALUES (?1,?2,?3,?4,?5,COALESCE(?6, datetime('now','localtime')), COALESCE(?7, datetime('now','localtime')))"#,
                params![
                    n.get("id").and_then(|v| v.as_i64()),
                    n.get("content").and_then(|v| v.as_str()).unwrap_or(""),
                    normalize_color(n.get("color").and_then(|v| v.as_str()).unwrap_or("yellow")),
                    n.get("pinned").and_then(|v| v.as_i64()).unwrap_or(0),
                    normalize_note_date(n.get("note_date").and_then(|v| v.as_str())),
                    n.get("created_at").and_then(|v| v.as_str()),
                    n.get("updated_at").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if let Some(arr) = data.get("mistakes").and_then(|v| v.as_array()) {
        for m in arr {
            // 旧备份没有图谱字段，导入后就是空，等同于没挂知识点的普通错题。
            //
            // 图谱三列走新建时同一条归一：备份里的空白串按「没挂」处理，
            // 而不是把空格原样写进库——不然导入一次就多出一条挂着空名字的错题。
            let (graph_topic_id, graph_subject, graph_topic_name) = normalize_graph_link(
                m.get("graph_topic_id").and_then(|v| v.as_str()).map(str::to_string),
                m.get("graph_subject").and_then(|v| v.as_str()).map(str::to_string),
                m.get("graph_topic_name").and_then(|v| v.as_str()).map(str::to_string),
            );
            tx.execute(
                r#"INSERT INTO mistakes (id, subject, title, reason, correct_note, is_mastered, created_at, updated_at, graph_topic_id, graph_subject, graph_topic_name)
                       VALUES (?1,?2,?3,?4,?5,?6,COALESCE(?7, datetime('now','localtime')), COALESCE(?8, datetime('now','localtime')),?9,?10,?11)"#,
                params![
                    m.get("id").and_then(|v| v.as_i64()),
                    normalize_subject(m.get("subject").and_then(|v| v.as_str()).unwrap_or("")),
                    m.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                    // 错因跟当前赛道的白名单走：前后端读同一份来源。
                    normalize_reason_with(&tx, m.get("reason").and_then(|v| v.as_str()).unwrap_or("其他")),
                    m.get("correct_note").and_then(|v| v.as_str()).unwrap_or(""),
                    m.get("is_mastered").and_then(|v| v.as_i64()).unwrap_or(0),
                    m.get("created_at").and_then(|v| v.as_str()),
                    m.get("updated_at").and_then(|v| v.as_str()),
                    graph_topic_id,
                    graph_subject,
                    graph_topic_name,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if let Some(s) = data.get("user_stats") {
        // Singleton row only: reject explicit id ≠ 1 (CHECK(id=1) would also fire on bad INSERT).
        // Missing id (export format) is treated as 1.
        if let Some(id) = s.get("id").and_then(|v| v.as_i64()) {
            if id != 1 {
                return Err(format!("user_stats.id must be 1 (singleton), got {id}"));
            }
        }
        // UPSERT: plain UPDATE is a silent no-op when id=1 is missing.
        tx.execute(
            r#"INSERT INTO user_stats (id, total_xp, current_level, current_streak, longest_streak, last_done_date)
               VALUES (1, ?1, ?2, ?3, ?4, ?5)
               ON CONFLICT(id) DO UPDATE SET
                 total_xp = excluded.total_xp,
                 current_level = excluded.current_level,
                 current_streak = excluded.current_streak,
                 longest_streak = excluded.longest_streak,
                 last_done_date = excluded.last_done_date"#,
            params![
                s.get("total_xp").and_then(|v| v.as_i64()).unwrap_or(0),
                s.get("current_level").and_then(|v| v.as_i64()).unwrap_or(1),
                s.get("current_streak").and_then(|v| v.as_i64()).unwrap_or(0),
                s.get("longest_streak").and_then(|v| v.as_i64()).unwrap_or(0),
                s.get("last_done_date").and_then(|v| v.as_str()),
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    if let Some(arr) = data.get("user_achievements").and_then(|v| v.as_array()) {
        for a in arr {
            tx.execute(
                "INSERT OR IGNORE INTO user_achievements (achievement_id, unlocked_at) VALUES (?1, COALESCE(?2, datetime('now','localtime')))",
                params![
                    a.get("achievement_id").and_then(|v| v.as_str()).unwrap_or(""),
                    a.get("unlocked_at").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if let Some(arr) = data.get("imported_textbooks").and_then(|v| v.as_array()) {
        for row in arr {
            tx.execute(
                r#"INSERT INTO imported_textbooks (id, subject, version, volume, outline_json, created_at, updated_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, datetime('now','localtime')), COALESCE(?7, datetime('now','localtime')))"#,
                params![
                    row.get("id").and_then(|v| v.as_i64()),
                    row.get("subject").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("version").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("volume").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("outline_json").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("created_at").and_then(|v| v.as_str()),
                    row.get("updated_at").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // Old backups omit `user_profile`. Reset to the seeded singleton so the
    // table is never left empty (export requires id=1). A present object replaces it.
    if let Some(value) = data.get("user_profile").filter(|v| !v.is_null()) {
        let (profile, updated_at) = user_profile_from_export(value)?;
        upsert_user_profile_row(&tx, &profile, updated_at.as_deref())?;
    } else {
        upsert_user_profile_row(&tx, &UserProfile::default(), None)?;
    }

    // Old backups omit `task_knowledge_points`. The DELETE above already left the table empty.
    // Old backups also omit the two graph columns; they stay NULL, so such rows keep
    // behaving like ordinary textbook points.
    if let Some(arr) = data.get("task_knowledge_points").and_then(|v| v.as_array()) {
        for row in arr {
            tx.execute(
                r#"INSERT INTO task_knowledge_points (
                     id, task_id, section_name, name, is_mastered, position, created_at,
                     graph_topic_id, graph_subject
                   ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, datetime('now','localtime')), ?8, ?9)"#,
                params![
                    row.get("id").and_then(|v| v.as_i64()),
                    row.get("task_id").and_then(|v| v.as_i64()).unwrap_or(0),
                    row.get("section_name").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("is_mastered").and_then(|v| v.as_i64()).unwrap_or(0),
                    row.get("position").and_then(|v| v.as_i64()).unwrap_or(0),
                    row.get("created_at").and_then(|v| v.as_str()),
                    row.get("graph_topic_id").and_then(|v| v.as_str()),
                    row.get("graph_subject").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // 科目字典：按 key 覆盖，不换 id，成绩行靠 key 找回科目。
    if let Some(arr) = data.get("subjects").and_then(|v| v.as_array()) {
        for row in arr {
            let key = row.get("key").and_then(|v| v.as_str()).unwrap_or("");
            if key.is_empty() {
                continue;
            }
            let track_id = resolve_track_id(
                &track_map,
                fallback_track,
                row.get("trackId")
                    .or_else(|| row.get("track_id"))
                    .and_then(|v| v.as_i64()),
            );
            tx.execute(
                r#"INSERT INTO subjects (key, label, full_mark, goal, unit, order_index, track_id)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                   ON CONFLICT(key) DO UPDATE SET
                     label = excluded.label,
                     full_mark = excluded.full_mark,
                     goal = excluded.goal,
                     unit = excluded.unit,
                     order_index = excluded.order_index,
                     track_id = COALESCE(excluded.track_id, subjects.track_id)"#,
                params![
                    key,
                    row.get("label").and_then(|v| v.as_str()).unwrap_or(key),
                    row.get("fullMark")
                        .or_else(|| row.get("full_mark"))
                        .and_then(|v| v.as_f64()),
                    row.get("goal").and_then(|v| v.as_f64()),
                    row.get("unit").and_then(|v| v.as_str()),
                    row.get("orderIndex")
                        .or_else(|| row.get("order_index"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0),
                    track_id,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // 3.x 旧备份没有 `subjects` 键：各科目标从档案里的 `subject_targets` 回填，
    // 否则导入后成绩页的目标虚线会退回默认值。
    if !data.get("subjects").and_then(|v| v.as_array()).is_some() {
        // 本机也没有科目字典时（换机 / 新装）按主赛道补齐出厂科目。
        // 不补的话后面展开旧 exam_records 时找不到科目，成绩行会被整段丢掉。
        let subject_count: i64 = tx
            .query_row("SELECT COUNT(*) FROM subjects", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if subject_count == 0 {
            if let Some(track_id) = fallback_track {
                let track = crate::commands::tracks::track_by_id(&tx, track_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "赛道不存在".to_string())?;
                crate::commands::tracks::seed_track_subjects(&tx, &track)?;
            }
        }

        let legacy_targets = data
            .get("user_profile")
            .and_then(|profile| profile.get("subject_targets"))
            .and_then(|value| match value {
                Value::String(raw) => serde_json::from_str::<Value>(raw).ok(),
                other => Some(other.clone()),
            });
        if let Some(Value::Object(map)) = legacy_targets {
            for (key, value) in map {
                let Some(score) = value.as_f64() else {
                    continue;
                };
                tx.execute(
                    "UPDATE subjects SET goal = ?1 WHERE key = ?2",
                    params![score, key],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    // 用户删过的科目：备份里带着，换机后不会被出厂科目重新播种回来。
    if let Some(arr) = data.get("removed_subjects").and_then(|v| v.as_array()) {
        for row in arr {
            let key = row.get("key").and_then(|v| v.as_str()).unwrap_or("");
            if key.is_empty() {
                continue;
            }
            tx.execute(
                r#"INSERT OR IGNORE INTO removed_subjects (key, removed_at)
                   VALUES (?1, COALESCE(?2, datetime('now','localtime')))"#,
                params![key, row.get("removedAt").and_then(|v| v.as_str())],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // 成绩：4.0 起是「场次 + 成绩行」。
    // 有 exam_sessions 就走新路径；只有老备份的 exam_records 就展开成场次 + 成绩行。
    let has_sessions = data.get("exam_sessions").and_then(|v| v.as_array()).is_some();
    if has_sessions {
        if let Some(arr) = data.get("exam_sessions").and_then(|v| v.as_array()) {
            for row in arr {
                let track_id = resolve_track_id(
                    &track_map,
                    fallback_track,
                    row.get("trackId")
                        .or_else(|| row.get("track_id"))
                        .and_then(|v| v.as_i64()),
                );
                tx.execute(
                    r#"INSERT INTO exam_sessions (id, track_id, name, date, is_mock, created_at)
                       VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, datetime('now','localtime')))"#,
                    params![
                        row.get("id").and_then(|v| v.as_i64()),
                        track_id,
                        row.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                        row.get("date").and_then(|v| v.as_str()).unwrap_or(""),
                        row.get("isMock")
                            .or_else(|| row.get("is_mock"))
                            .and_then(|v| v.as_i64().or_else(|| v.as_bool().map(i64::from)))
                            .unwrap_or(0),
                        row.get("createdAt")
                            .or_else(|| row.get("created_at"))
                            .and_then(|v| v.as_str()),
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        if let Some(arr) = data.get("exam_scores").and_then(|v| v.as_array()) {
            for row in arr {
                let subject_id = match row
                    .get("subjectKey")
                    .or_else(|| row.get("subject_key"))
                    .and_then(|v| v.as_str())
                {
                    Some(key) => subject_id_for_key(&tx, key)?,
                    None => row
                        .get("subjectId")
                        .or_else(|| row.get("subject_id"))
                        .and_then(|v| v.as_i64()),
                };
                // 科目已经不在字典里的成绩行直接跳过 —— 留着会让成绩页报错。
                let Some(subject_id) = subject_id else {
                    continue;
                };
                tx.execute(
                    r#"INSERT OR IGNORE INTO exam_scores (exam_id, subject_id, score)
                       VALUES (?1, ?2, ?3)"#,
                    params![
                        row.get("examId")
                            .or_else(|| row.get("exam_id"))
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0),
                        subject_id,
                        row.get("score").and_then(|v| v.as_f64()),
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    } else if let Some(arr) = data.get("exam_records").and_then(|v| v.as_array()) {
        // 老备份：一行六科，展开成一场 + 六行成绩。
        for row in arr {
            tx.execute(
                r#"INSERT INTO exam_sessions (id, track_id, name, date, is_mock, created_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, datetime('now','localtime')))"#,
                params![
                    row.get("id").and_then(|v| v.as_i64()),
                    fallback_track,
                    row.get("exam_name").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("exam_date").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("is_mock").and_then(|v| v.as_i64()).unwrap_or(0),
                    row.get("created_at").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
            let exam_id = tx.last_insert_rowid();
            for (field, key) in LEGACY_SCORE_FIELDS {
                let score = row.get(field).and_then(|v| v.as_i64()).map(|v| v as f64);
                let Some(subject_id) = subject_id_for_key(&tx, key)? else {
                    continue;
                };
                tx.execute(
                    r#"INSERT OR IGNORE INTO exam_scores (exam_id, subject_id, score)
                       VALUES (?1, ?2, ?3)"#,
                    params![exam_id, subject_id, score],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    // 历史场次补赛道归属：旧备份展开出来的场次没带赛道，
    // 备份里显式留空的也一并兜底 —— 成绩页按赛道筛选时这些场次不能消失。
    tx.execute(
        "UPDATE exam_sessions SET track_id = ?1 WHERE track_id IS NULL",
        params![fallback_track],
    )
    .map_err(|e| e.to_string())?;

    // 目标：4.0 起落在 `goals` 表。
    // v1 旧备份没有这个键，补一条默认目标，不能报错也不能把表留空。
    if let Some(arr) = data.get("goals").and_then(|v| v.as_array()) {
        for row in arr {
            let track_id = resolve_track_id(
                &track_map,
                fallback_track,
                row.get("trackId")
                    .or_else(|| row.get("track_id"))
                    .and_then(|v| v.as_i64()),
            );
            tx.execute(
                r#"INSERT INTO goals (id, track_id, name, date, kind, is_primary, target_score, created_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, COALESCE(?8, datetime('now','localtime')))"#,
                params![
                    row.get("id").and_then(|v| v.as_i64()),
                    track_id,
                    row.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("date").and_then(|v| v.as_str()).unwrap_or(""),
                    row.get("kind")
                        .and_then(|v| v.as_str())
                        .unwrap_or(crate::commands::goals::GOAL_KIND_EXAM),
                    row.get("isPrimary")
                        .or_else(|| row.get("is_primary"))
                        // 导出的 payload 里是布尔值，旧备份里可能是 0/1。
                        .and_then(|v| v.as_i64().or_else(|| v.as_bool().map(i64::from)))
                        .unwrap_or(0),
                    row.get("targetScore")
                        .or_else(|| row.get("target_score"))
                        .and_then(|v| v.as_f64()),
                    row.get("createdAt")
                        .or_else(|| row.get("created_at"))
                        .and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    } else {
        tx.execute(
            "INSERT INTO goals (track_id, name, date, kind, is_primary) VALUES (?1, ?2, ?3, ?4, 1)",
            params![
                fallback_track,
                crate::commands::goals::DEFAULT_GOAL_NAME,
                crate::commands::goals::DEFAULT_GOAL_DATE,
                crate::commands::goals::GOAL_KIND_EXAM
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    // B 兜底：其它 FK（如 rescheduled_to）仍可能漏网；有违规则不 commit。
    {
        let mut stmt = tx
            .prepare("PRAGMA foreign_key_check")
            .map_err(|e| e.to_string())?;
        let violations: Vec<(String, i64, String, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if !violations.is_empty() {
            return Err(format!("import foreign_key_check failed: {violations:?}"));
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_json(state: State<'_, DbState>) -> Result<String, String> {
    with_db(&state, export_json_impl)
}

#[tauri::command]
pub fn import_json(app: AppHandle, state: State<'_, DbState>, json: String) -> Result<(), String> {
    let path = db_path(&app)?;
    // backup current db file
    let backup = path.with_extension(format!(
        "bak-{}.db",
        chrono::Local::now().format("%Y%m%d%H%M%S")
    ));
    if path.exists() {
        fs::copy(&path, &backup).map_err(|e| e.to_string())?;
    }

    with_db(&state, |conn| import_json_impl(conn, &json))
}
