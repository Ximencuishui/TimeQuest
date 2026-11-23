//! 赛道与科目字典。
//!
//! 覆盖：赛道 CRUD、主赛道唯一、科目增删改、`full_mark` 可空、
//! 删科目时成绩行处理、导出导入往返后赛道归属不丢。

use rusqlite::{params, Connection};
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use timequest_lib::{
    create_exam_session_impl, export_json_impl, import_json_impl, list_exam_sessions_impl,
    list_subjects_impl, list_tracks_impl, remove_subject_impl, remove_track_impl,
    upsert_subject_impl, upsert_track_impl, CreateExamSessionPayload, ExamScoreInput,
    UpsertSubjectPayload, UpsertTrackPayload,
};

async fn open_rusqlite_migrated() -> (PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("timequest-tracks-{}.db", uuid::Uuid::new_v4()));
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    let path_str = path.to_string_lossy().replace('\\', "/");
    let url = format!("sqlite:{path_str}?mode=rwc");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect temp sqlite");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("pragma");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("migrate");
    pool.close().await;

    let conn = Connection::open(&path).expect("rusqlite open");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("pragma foreign_keys");
    (path, conn)
}

fn track_payload(name: &str, primary: bool) -> UpsertTrackPayload {
    UpsertTrackPayload {
        id: None,
        name: name.to_string(),
        kind: Some("exam".to_string()),
        score_mode: Some("total".to_string()),
        is_primary: Some(primary),
        color: None,
    }
}

fn subject_payload(key: &str, label: &str) -> UpsertSubjectPayload {
    UpsertSubjectPayload {
        id: None,
        track_id: None,
        key: Some(key.to_string()),
        label: label.to_string(),
        full_mark: Some(100.0),
        goal: Some(90.0),
        unit: Some("分".to_string()),
        order_index: None,
    }
}

#[tokio::test]
async fn migration_seeds_one_primary_track() {
    let (_path, conn) = open_rusqlite_migrated().await;
    let tracks = list_tracks_impl(&conn).expect("tracks");
    assert_eq!(tracks.len(), 1, "迁移后只有一条默认赛道");
    assert_eq!(tracks[0].name, "高考");
    assert_eq!(tracks[0].kind, "exam");
    assert_eq!(tracks[0].score_mode, "total");
    assert!(tracks[0].is_primary);
}

#[tokio::test]
async fn seed_subjects_belong_to_the_default_track() {
    let (_path, conn) = open_rusqlite_migrated().await;
    let tracks = list_tracks_impl(&conn).expect("tracks");
    let track_id = tracks[0].id;
    let subjects = list_subjects_impl(&conn, Some(track_id)).expect("subjects");
    assert_eq!(subjects.len(), 6, "六科都归在默认赛道下");
    assert!(subjects.iter().all(|subject| subject.track_id == Some(track_id)));
}

#[tokio::test]
async fn upsert_track_creates_updates_and_keeps_one_primary() {
    let (_path, conn) = open_rusqlite_migrated().await;
    let seeded = list_tracks_impl(&conn).expect("tracks");

    let second = upsert_track_impl(&conn, track_payload("考研", false)).expect("create track");
    assert_eq!(second.name, "考研");
    assert!(!second.is_primary);

    // 主赛道唯一：把第二条设成主赛道，第一条自动降级。
    let updated = upsert_track_impl(
        &conn,
        UpsertTrackPayload {
            id: Some(second.id),
            name: "考研".to_string(),
            kind: Some("exam".to_string()),
            score_mode: Some("per_subject".to_string()),
            is_primary: Some(true),
            color: Some("#ff0000".to_string()),
        },
    )
    .expect("update track");
    assert_eq!(updated.score_mode, "per_subject");
    assert_eq!(updated.color.as_deref(), Some("#ff0000"));
    assert!(updated.is_primary);

    let tracks = list_tracks_impl(&conn).expect("tracks");
    let primaries: Vec<_> = tracks.iter().filter(|track| track.is_primary).collect();
    assert_eq!(primaries.len(), 1, "主赛道永远只有一个");
    assert_eq!(primaries[0].id, second.id);
    assert!(!tracks.iter().any(|track| track.id == seeded[0].id && track.is_primary));
}

#[tokio::test]
async fn upsert_track_rejects_bad_kind_and_empty_name() {
    let (_path, conn) = open_rusqlite_migrated().await;
    let err = upsert_track_impl(
        &conn,
        UpsertTrackPayload {
            id: None,
            name: "  ".to_string(),
            kind: None,
            score_mode: None,
            is_primary: None,
            color: None,
        },
    )
    .expect_err("empty name");
    assert!(err.contains("赛道名称"), "got {err}");

    let err = upsert_track_impl(
        &conn,
        UpsertTrackPayload {
            id: None,
            name: "奇怪的赛道".to_string(),
            kind: Some("unknown".to_string()),
            score_mode: None,
            is_primary: None,
            color: None,
        },
    )
    .expect_err("bad kind");
    assert!(err.contains("类型"), "got {err}");
}

#[tokio::test]
async fn upsert_subject_adds_updates_and_allows_null_full_mark() {
    let (_path, conn) = open_rusqlite_migrated().await;
    let tracks = list_tracks_impl(&conn).expect("tracks");
    let track_id = tracks[0].id;

    let mut payload = subject_payload("history", "历史");
    payload.track_id = Some(track_id);
    payload.full_mark = None;
    payload.goal = None;
    let created = upsert_subject_impl(&conn, payload).expect("create subject");
    assert_eq!(created.key, "history");
    assert_eq!(created.label, "历史");
    assert_eq!(created.full_mark, None, "满分可以为空");
    assert_eq!(created.goal, None);
    assert_eq!(created.track_id, Some(track_id));

    // 改这一科：key 不传时沿用旧 key。
    let updated = upsert_subject_impl(
        &conn,
        UpsertSubjectPayload {
            id: Some(created.id),
            track_id: None,
            key: None,
            label: "世界历史".to_string(),
            full_mark: Some(50.0),
            goal: Some(45.0),
            unit: Some("分".to_string()),
            order_index: None,
        },
    )
    .expect("update subject");
    assert_eq!(updated.key, "history", "key 不传时保持不变");
    assert_eq!(updated.label, "世界历史");
    assert_eq!(updated.full_mark, Some(50.0));
    assert_eq!(updated.track_id, Some(track_id), "track_id 不传时保持不变");

    let subjects = list_subjects_impl(&conn, Some(track_id)).expect("subjects");
    assert_eq!(subjects.len(), 7);
    assert_eq!(subjects.last().map(|s| s.key.as_str()), Some("history"));
}

#[tokio::test]
async fn upsert_subject_rejects_duplicate_key_and_negative_scores() {
    let (_path, conn) = open_rusqlite_migrated().await;
    let err = upsert_subject_impl(&conn, subject_payload("math", "数学2")).expect_err("dup key");
    assert!(err.contains("已存在"), "got {err}");

    let mut payload = subject_payload("newton", "力学");
    payload.full_mark = Some(-1.0);
    let err = upsert_subject_impl(&conn, payload).expect_err("negative full mark");
    assert!(err.contains("满分"), "got {err}");

    let mut payload = subject_payload("newton", "力学");
    payload.goal = Some(-1.0);
    let err = upsert_subject_impl(&conn, payload).expect_err("negative goal");
    assert!(err.contains("目标"), "got {err}");
}

#[tokio::test]
async fn remove_subject_cleans_up_its_score_rows() {
    let (_path, conn) = open_rusqlite_migrated().await;
    let created = upsert_subject_impl(&conn, subject_payload("physics2", "物理2")).expect("create");
    let session = create_exam_session_impl(
        &conn,
        CreateExamSessionPayload {
            track_id: None,
            name: "一模".to_string(),
            date: "2026-10-08".to_string(),
            scores: vec![ExamScoreInput {
                subject_key: "physics2".to_string(),
                score: Some(66.0),
            }],
        },
    )
    .expect("create session");
    assert_eq!(session.scores.len(), 1);

    let score_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM exam_scores WHERE subject_id = ?1",
            params![created.id],
            |r| r.get(0),
        )
        .expect("count scores");
    assert_eq!(score_rows, 1);

    remove_subject_impl(&conn, created.id).expect("remove subject");

    let score_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM exam_scores WHERE subject_id = ?1",
            params![created.id],
            |r| r.get(0),
        )
        .expect("count scores");
    assert_eq!(score_rows, 0, "成绩行一起清掉，不留悬空引用");

    // 成绩页还能正常列出这场考试，不会因为少了科目而报错。
    let sessions = list_exam_sessions_impl(&conn).expect("sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].scores.len(), 0);
}

#[tokio::test]
async fn remove_track_keeps_history_but_clears_ownership() {
    let (_path, conn) = open_rusqlite_migrated().await;
    let tracks = list_tracks_impl(&conn).expect("tracks");
    let track_id = tracks[0].id;

    create_exam_session_impl(
        &conn,
        CreateExamSessionPayload {
            track_id: Some(track_id),
            name: "一模".to_string(),
            date: "2026-10-08".to_string(),
            scores: vec![ExamScoreInput {
                subject_key: "chinese".to_string(),
                score: Some(110.0),
            }],
        },
    )
    .expect("create session");

    remove_track_impl(&conn, track_id).expect("remove track");

    let subject_track: Option<i64> = conn
        .query_row(
            "SELECT track_id FROM subjects WHERE key = 'chinese'",
            [],
            |r| r.get(0),
        )
        .expect("subject row");
    assert_eq!(subject_track, None, "科目解除归属，不被删掉");

    let sessions = list_exam_sessions_impl(&conn).expect("sessions");
    assert_eq!(sessions.len(), 1, "历史成绩留着");
    assert_eq!(sessions[0].scores.len(), 1);

    // 主赛道被删后，剩下的赛道顶上。
    let tracks = list_tracks_impl(&conn).expect("tracks");
    assert_eq!(tracks.len(), 0);
}

#[tokio::test]
async fn export_import_round_trip_keeps_tracks_and_subject_ownership() {
    let (_path, conn) = open_rusqlite_migrated().await;
    upsert_track_impl(&conn, track_payload("考研", false)).expect("create track");

    let payload = export_json_impl(&conn).expect("export");
    let parsed: serde_json::Value = serde_json::from_str(&payload).expect("parse payload");
    let exported_tracks = parsed.get("tracks").and_then(|v| v.as_array()).expect("tracks key");
    assert_eq!(exported_tracks.len(), 2);
    assert_eq!(exported_tracks[0].get("name").and_then(|v| v.as_str()), Some("高考"));
    assert_eq!(
        exported_tracks[0].get("scoreMode").and_then(|v| v.as_str()),
        Some("total")
    );
    let exported_subjects = parsed
        .get("subjects")
        .and_then(|v| v.as_array())
        .expect("subjects key");
    assert!(exported_subjects
        .iter()
        .all(|subject| subject.get("trackId").is_some()));

    // 换一个新库导入，赛道 id 会变，但科目归属要跟回来。
    let (_path2, conn2) = open_rusqlite_migrated().await;
    import_json_impl(&conn2, &payload).expect("import");

    let tracks2 = list_tracks_impl(&conn2).expect("tracks after import");
    assert_eq!(tracks2.len(), 2, "赛道跟着备份走");
    let primary = tracks2
        .iter()
        .find(|track| track.is_primary)
        .expect("primary track");
    let subjects2 = list_subjects_impl(&conn2, Some(primary.id)).expect("subjects after import");
    assert_eq!(subjects2.len(), 6, "六科仍然挂在主赛道下");
    assert!(subjects2
        .iter()
        .all(|subject| subject.track_id == Some(primary.id)));
}
