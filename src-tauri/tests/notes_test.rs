//! Notes `updated_at` refresh and list order.
//!
//! B 段确认（提示词 0）：
//! 1. `update_note` 显式 `updated_at=datetime('now','localtime')`（非裸 `datetime('now')`）。
//! 2. 无触发器；与 notes / tasks / sessions / logs / achievements 时间戳同为 localtime。
//! 3. `list_notes`：`ORDER BY pinned DESC, updated_at DESC, id DESC`。
//!    同秒更新按 id 倒序，避免列表顺序不稳定。

use rusqlite::{params, Connection};
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use timequest_lib::{
    create_note_impl, list_notes_impl, update_note_impl, UpdateNotePayload,
};

async fn open_rusqlite_migrated() -> (PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!(
        "timequest-notes-{}.db",
        uuid::Uuid::new_v4()
    ));
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

fn insert_note(
    conn: &Connection,
    content: &str,
    color: &str,
    pinned: i64,
    created_at: &str,
    updated_at: &str,
) -> i64 {
    conn.execute(
        r#"INSERT INTO notes (content, color, pinned, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)"#,
        params![content, color, pinned, created_at, updated_at],
    )
    .expect("insert note");
    conn.last_insert_rowid()
}

#[tokio::test]
async fn update_note_refreshes_updated_at_on_inplace_edit() {
    let (path, conn) = open_rusqlite_migrated().await;
    let id = insert_note(
        &conn,
        "原稿",
        "yellow",
        0,
        "2026-01-10 08:00:00",
        "2026-01-10 08:00:00",
    );
    let before: (String, String) = conn
        .query_row(
            "SELECT created_at, updated_at FROM notes WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(before.0, before.1, "seed: created_at == updated_at");

    // SQLite datetime 秒级；至少等 1s 才能保证严格大于。
    thread::sleep(Duration::from_secs(1));

    let updated = update_note_impl(
        &conn,
        id,
        UpdateNotePayload {
            content: Some("改后".into()),
            color: None,
            pinned: None,
        },
    )
    .expect("update_note");

    assert_eq!(updated.content, "改后", "a. content 已更新");
    assert_eq!(updated.color, "yellow");
    assert_eq!(updated.pinned, 0);
    assert!(
        updated.updated_at.as_str() > before.1.as_str(),
        "b. updated_at 必须严格大于修改前: before={}, after={}",
        before.1,
        updated.updated_at
    );
    assert_eq!(
        updated.created_at, before.0,
        "c. created_at 保持不变"
    );

    let _ = std::fs::remove_file(&path);
}

/// 排序语义：`ORDER BY pinned DESC, updated_at DESC, id DESC`。
/// 本用例全部 pinned=0，故仅按 updated_at：编辑 A 后顺序为 A、C、B。
#[tokio::test]
async fn list_notes_orders_by_updated_at_desc() {
    let (path, conn) = open_rusqlite_migrated().await;
    let id_a = insert_note(
        &conn,
        "A",
        "yellow",
        0,
        "2026-01-01 10:00:00",
        "2026-01-01 10:00:00",
    );
    let id_b = insert_note(
        &conn,
        "B",
        "yellow",
        0,
        "2026-01-02 10:00:00",
        "2026-01-02 10:00:00",
    );
    let id_c = insert_note(
        &conn,
        "C",
        "yellow",
        0,
        "2026-01-03 10:00:00",
        "2026-01-03 10:00:00",
    );
    assert!(id_a > 0 && id_b > 0 && id_c > 0);

    thread::sleep(Duration::from_secs(1));
    update_note_impl(
        &conn,
        id_a,
        UpdateNotePayload {
            content: Some("A-edited".into()),
            color: None,
            pinned: None,
        },
    )
    .expect("update A");

    let listed = list_notes_impl(&conn).expect("list_notes");
    assert_eq!(listed.len(), 3);
    assert_eq!(
        listed[0].content, "A-edited",
        "A 最近编辑应排最前"
    );
    assert_eq!(listed[1].content, "C", "C 比 B 新");
    assert_eq!(listed[2].content, "B");
    assert_eq!(listed[0].id, id_a);
    assert_eq!(listed[1].id, id_c);
    assert_eq!(listed[2].id, id_b);

    let _ = std::fs::remove_file(&path);
}

/// 选择 **a**：每次 `update_note` 都写库并刷新 `updated_at`（实现无 diff 短路）。
/// 传入与当前完全相同的 content/color/pinned 仍会执行
/// `updated_at=datetime('now','localtime')`。
#[tokio::test]
async fn update_note_does_not_change_updated_at_when_no_field_changed() {
    let (path, conn) = open_rusqlite_migrated().await;
    let id = insert_note(
        &conn,
        "same",
        "blue",
        0,
        "2026-02-01 12:00:00",
        "2026-02-01 12:00:00",
    );
    let before: String = conn
        .query_row(
            "SELECT updated_at FROM notes WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap();

    thread::sleep(Duration::from_secs(1));
    let after = update_note_impl(
        &conn,
        id,
        UpdateNotePayload {
            content: Some("same".into()),
            color: Some("blue".into()),
            pinned: Some(false),
        },
    )
    .expect("noop-looking update");

    assert_eq!(after.content, "same");
    assert_eq!(after.color, "blue");
    assert_eq!(after.pinned, 0);
    assert!(
        after.updated_at.as_str() > before.as_str(),
        "a. 无字段变化仍刷新 updated_at: before={before}, after={}",
        after.updated_at
    );

    let _ = std::fs::remove_file(&path);
}

/// 选项 B：非法 color 写入前归一为 `"yellow"`，不拒绝。
#[tokio::test]
async fn create_note_normalizes_invalid_color_to_default() {
    let (path, conn) = open_rusqlite_migrated().await;
    let note = create_note_impl(&conn, "脏色".into(), "neon".into()).expect("create");
    assert_eq!(note.color, "yellow");
    let stored: String = conn
        .query_row(
            "SELECT color FROM notes WHERE id=?1",
            params![note.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, "yellow");
    let _ = std::fs::remove_file(&path);
}

/// 选项 B：update 传入非法 color 同样归一为 `"yellow"`。
#[tokio::test]
async fn update_note_normalizes_invalid_color_to_default() {
    let (path, conn) = open_rusqlite_migrated().await;
    let id = insert_note(
        &conn,
        "原稿",
        "blue",
        0,
        "2026-03-01 10:00:00",
        "2026-03-01 10:00:00",
    );
    let updated = update_note_impl(
        &conn,
        id,
        UpdateNotePayload {
            content: None,
            color: Some("neon".into()),
            pinned: None,
        },
    )
    .expect("update");
    assert_eq!(updated.color, "yellow");
    let stored: String = conn
        .query_row(
            "SELECT color FROM notes WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, "yellow");
    let _ = std::fs::remove_file(&path);
}

/// 同秒 `updated_at` 时按 `id DESC` 稳定倒序。插入序 A、B、C → 列表 C、B、A。
#[tokio::test]
async fn list_notes_sort_order_is_stable_for_equal_updated_at() {
    let (path, conn) = open_rusqlite_migrated().await;
    let same = "2026-01-01 10:00:00";
    insert_note(&conn, "A", "yellow", 0, same, same);
    insert_note(&conn, "B", "orange", 0, same, same);
    insert_note(&conn, "C", "green", 0, same, same);

    let orders: Vec<Vec<String>> = (0..3)
        .map(|_| {
            list_notes_impl(&conn)
                .expect("list_notes")
                .into_iter()
                .map(|n| n.content)
                .collect()
        })
        .collect();
    assert_eq!(orders[0], orders[1], "a. second call matches first");
    assert_eq!(orders[1], orders[2], "a. third call matches second");
    assert_eq!(
        orders[0],
        vec!["C".to_string(), "B".into(), "A".into()],
        "b. id DESC tiebreaker: C, B, A"
    );

    let _ = std::fs::remove_file(&path);
}

/// pinned DESC 先于 updated_at DESC；组内再按 updated_at DESC, id DESC。
#[tokio::test]
async fn list_notes_pinned_sort_before_updated_at() {
    let (path, conn) = open_rusqlite_migrated().await;
    // 插入序即 id 序：X=1, Y=2, Y2=3, Y2b=4, X2=5。
    insert_note(
        &conn,
        "X",
        "yellow",
        0,
        "2026-01-03 12:00:00",
        "2026-01-03 12:00:00",
    );
    insert_note(
        &conn,
        "Y",
        "blue",
        1,
        "2026-01-01 09:00:00",
        "2026-01-01 09:00:00",
    );
    insert_note(
        &conn,
        "Y2",
        "green",
        1,
        "2026-01-02 09:00:00",
        "2026-01-02 09:00:00",
    );
    insert_note(
        &conn,
        "Y2b",
        "pink",
        1,
        "2026-01-02 09:00:00",
        "2026-01-02 09:00:00",
    );
    insert_note(
        &conn,
        "X2",
        "orange",
        0,
        "2026-01-03 12:00:00",
        "2026-01-03 12:00:00",
    );

    let listed = list_notes_impl(&conn).expect("list_notes");
    let contents: Vec<&str> = listed.iter().map(|n| n.content.as_str()).collect();
    // 置顶组：Y2b、Y2 同秒，id DESC → Y2b 在 Y2 前；Y 更早。
    // 未置顶组：X2、X 同秒，id DESC → X2 在 X 前。Y 仍在 X 前。
    assert_eq!(contents, vec!["Y2b", "Y2", "Y", "X2", "X"]);
    let y = contents.iter().position(|c| *c == "Y").unwrap();
    let x = contents.iter().position(|c| *c == "X").unwrap();
    assert!(y < x, "a. pinned Y before newer unpinned X");

    let _ = std::fs::remove_file(&path);
}
