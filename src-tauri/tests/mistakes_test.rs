//! 错题本：错因归一、订正状态、列表顺序、导出导入往返。
//!
//! 错题本是给学生自己记错题用的，MVP 只保四件事：
//! 1. 错因是闭合集合，未知值归到「其他」，不会出现奇怪的自由文本。
//! 2. 科目是开放字符串，但空值归到「其他」。
//! 3. 未订正的错题排在前面——复习时先看没搞懂的。
//! 4. 导出的备份要能原样导回来。

use rusqlite::Connection;
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use timequest_lib::{
    create_mistake_impl, delete_mistake_impl, export_json_impl, import_json_impl, list_mistakes_impl,
    normalize_reason, normalize_subject, update_mistake_impl, UpdateMistakePayload, REASON_WHITELIST,
};

async fn open_rusqlite_migrated() -> (PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("timequest-mistakes-{}.db", uuid::Uuid::new_v4()));
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

#[test]
fn frontend_reason_list_matches_backend_whitelist() {
    // 护栏：前端下拉框（src/lib/mistakes.ts 的 MISTAKE_REASONS）必须与后端白名单一致，
    // 否则用户会选到后端静默改成「其他」的错因。
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("lib")
        .join("mistakes.ts");
    let source = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let start = source
        .find("MISTAKE_REASONS = [")
        .unwrap_or_else(|| panic!("MISTAKE_REASONS block not found in {}", path.display()));
    let end = source[start..]
        .find("] as const;")
        .unwrap_or_else(|| panic!("MISTAKE_REASONS block is not closed in {}", path.display()))
        + start;
    let frontend: Vec<&str> = source[start..end]
        .lines()
        .filter_map(|line| line.trim().strip_prefix('"'))
        .filter_map(|rest| rest.split('"').next())
        .collect();
    assert_eq!(
        frontend,
        REASON_WHITELIST.to_vec(),
        "frontend MISTAKE_REASONS must match Rust REASON_WHITELIST"
    );
}

#[test]
fn normalize_reason_maps_unknown_to_other() {
    assert_eq!(normalize_reason("概念不清"), "概念不清");
    assert_eq!(normalize_reason("  审题失误  "), "审题失误");
    assert_eq!(normalize_reason("瞎写的"), "其他");
    assert_eq!(normalize_reason(""), "其他");
}

#[test]
fn normalize_subject_trims_and_falls_back_to_other() {
    assert_eq!(normalize_subject("  物理 "), "物理");
    assert_eq!(normalize_subject("   "), "其他");
    assert_eq!(normalize_subject(""), "其他");
}

#[tokio::test]
async fn create_mistake_stores_normalized_reason_and_subject() {
    let (path, conn) = open_rusqlite_migrated().await;

    let created = create_mistake_impl(
        &conn,
        "  物理  ".to_string(),
        "牛顿第二定律应用".to_string(),
        "瞎写的".to_string(),
        "先选正方向再列 F=ma".to_string(),
    )
    .expect("create mistake");

    assert_eq!(created.subject, "物理");
    assert_eq!(created.reason, "其他");
    assert_eq!(created.title, "牛顿第二定律应用");
    assert_eq!(created.correct_note, "先选正方向再列 F=ma");
    assert_eq!(created.is_mastered, 0);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn list_mistakes_puts_unmastered_first() {
    let (path, conn) = open_rusqlite_migrated().await;

    let mastered = create_mistake_impl(
        &conn,
        "数学".into(),
        "已订正的题".into(),
        "计算失误".into(),
        "".into(),
    )
    .expect("create mastered");
    let pending = create_mistake_impl(
        &conn,
        "化学".into(),
        "还没订正的题".into(),
        "概念不清".into(),
        "".into(),
    )
    .expect("create pending");

    update_mistake_impl(
        &conn,
        mastered.id,
        UpdateMistakePayload {
            is_mastered: Some(1),
            ..Default::default()
        },
    )
    .expect("mark mastered");

    let rows = list_mistakes_impl(&conn).expect("list");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].id, pending.id);
    assert_eq!(rows[0].is_mastered, 0);
    assert_eq!(rows[1].id, mastered.id);
    assert_eq!(rows[1].is_mastered, 1);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn update_mistake_only_touches_given_fields() {
    let (path, conn) = open_rusqlite_migrated().await;

    let created = create_mistake_impl(
        &conn,
        "物理".into(),
        "原题".into(),
        "公式记错".into(),
        "原思路".into(),
    )
    .expect("create");

    let updated = update_mistake_impl(
        &conn,
        created.id,
        UpdateMistakePayload {
            title: Some("改过的题".into()),
            ..Default::default()
        },
    )
    .expect("update");

    assert_eq!(updated.title, "改过的题");
    assert_eq!(updated.subject, "物理");
    assert_eq!(updated.reason, "公式记错");
    assert_eq!(updated.correct_note, "原思路");
    assert_eq!(updated.is_mastered, 0);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn delete_mistake_removes_the_row() {
    let (path, conn) = open_rusqlite_migrated().await;

    let created = create_mistake_impl(&conn, "生物".into(), "题".into(), "其他".into(), "".into())
        .expect("create");
    delete_mistake_impl(&conn, created.id).expect("delete");

    assert!(list_mistakes_impl(&conn).expect("list").is_empty());

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn mistakes_survive_export_import_round_trip() {
    let (path, conn) = open_rusqlite_migrated().await;

    let created = create_mistake_impl(
        &conn,
        "英语".into(),
        "定语从句".into(),
        "审题失误".into(),
        "先找先行词".into(),
    )
    .expect("create");
    update_mistake_impl(
        &conn,
        created.id,
        UpdateMistakePayload {
            is_mastered: Some(1),
            ..Default::default()
        },
    )
    .expect("mark mastered");

    let json = export_json_impl(&conn).expect("export");
    assert!(json.contains("定语从句"), "export must contain the mistake");

    import_json_impl(&conn, &json).expect("import");

    let rows = list_mistakes_impl(&conn).expect("list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].subject, "英语");
    assert_eq!(rows[0].reason, "审题失误");
    assert_eq!(rows[0].correct_note, "先找先行词");
    assert_eq!(rows[0].is_mastered, 1);

    let _ = std::fs::remove_file(&path);
}
