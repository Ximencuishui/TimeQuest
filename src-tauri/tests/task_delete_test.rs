use rusqlite::Connection;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::path::PathBuf;
use timequest_lib::{
    advance_round_impl, archive_task_impl, create_session_impl, delete_task_impl, fetch_task_impl,
    list_deleted_tasks_impl, list_sessions_in_range_impl, list_tasks_impl, purge_task_impl,
    restore_task_impl, SessionError,
};

/// In-memory DB with migrations applied, plus a rusqlite handle on the same file
/// (the task commands run on the rusqlite connection, not the sqlx pool).
async fn open_shared() -> (PathBuf, SqlitePool, Connection) {
    let path =
        std::env::temp_dir().join(format!("timequest-task-delete-{}.db", uuid::Uuid::new_v4()));
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    let path_str = path.to_string_lossy().replace('\\', "/");
    let url = format!("sqlite:{path_str}?mode=rwc");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let conn = Connection::open(&path).expect("rusqlite");
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    (path, pool, conn)
}

async fn insert_task(pool: &SqlitePool, title: &str) -> i64 {
    sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, textbook, unit_name, total_units, total_rounds, current_round)
           VALUES (?1, 'main', '数学', '人教A版', '课', 20, 2, 1)"#,
    )
    .bind(title)
    .execute(pool)
    .await
    .expect("insert task")
    .last_insert_rowid()
}

async fn insert_session(pool: &SqlitePool, task_id: i64, date: &str) -> i64 {
    sqlx::query(
        r#"INSERT INTO task_sessions (task_id, date, start_time, end_time, round, planned_units, status)
           VALUES (?1, ?2, '09:00', '10:00', 1, 2, 'done')"#,
    )
    .bind(task_id)
    .bind(date)
    .execute(pool)
    .await
    .expect("insert session")
    .last_insert_rowid()
}

async fn insert_log(pool: &SqlitePool, session_id: i64) {
    sqlx::query(
        r#"INSERT INTO actual_logs (date, start_at, end_at, duration_min, subject, method, tag_type, session_id)
           VALUES ('2026-11-04', '09:00', '10:00', 60, '数学', '刷题', 'study', ?1)"#,
    )
    .bind(session_id)
    .execute(pool)
    .await
    .expect("insert log");
}

async fn insert_point(pool: &SqlitePool, task_id: i64) {
    sqlx::query(
        r#"INSERT INTO task_knowledge_points (task_id, section_name, name)
           VALUES (?1, '第一章', '集合与常用逻辑用语')"#,
    )
    .bind(task_id)
    .execute(pool)
    .await
    .expect("insert knowledge point");
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn delete_task_marks_the_task_deleted_and_keeps_everything_else() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;
    let session_id = insert_session(&pool, task_id, "2026-11-04").await;
    insert_log(&pool, session_id).await;
    insert_point(&pool, task_id).await;

    delete_task_impl(&conn, task_id).expect("delete task");

    // 任务行还在，只是打了删除标记 —— 找得回来。
    let deleted_at: Option<String> = sqlx::query_scalar("SELECT deleted_at FROM tasks WHERE id = ?1")
        .bind(task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        deleted_at.is_some(),
        "删除后要写上 deleted_at，任务才有地方找回来"
    );

    // 排期、流水、考点全部保留：删除只是收起来，不是抹掉。
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM tasks").await, 1);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_sessions").await, 1);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM actual_logs").await, 1);
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM task_knowledge_points").await,
        1,
        "考点要跟着任务留着，恢复后还能用"
    );

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn deleted_task_is_hidden_from_the_plan_list_but_shown_in_the_trash() {
    let (path, pool, conn) = open_shared().await;
    let keep_id = insert_task(&pool, "物理必修二").await;
    let drop_id = insert_task(&pool, "数学必修一").await;

    delete_task_impl(&conn, drop_id).expect("delete task");

    let plan = list_tasks_impl(&conn, false).expect("list tasks");
    assert_eq!(plan.len(), 1);
    assert_eq!(plan[0].id, keep_id, "回收站里的任务不进计划");

    // 连「显示已归档任务」也不该看到它 —— 归档和删除是两件事。
    let with_archived = list_tasks_impl(&conn, true).expect("list tasks");
    assert_eq!(
        with_archived.len(),
        1,
        "回收站里的任务不跟归档任务混在一起"
    );

    let trash = list_deleted_tasks_impl(&conn).expect("list deleted tasks");
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].id, drop_id);
    assert!(trash[0].deleted_at.is_some());

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn deleted_task_sessions_are_hidden_from_the_day_view() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;
    insert_session(&pool, task_id, "2026-11-04").await;

    let before = list_sessions_in_range_impl(&pool, "2026-11-04", "2026-11-04")
        .await
        .expect("list sessions");
    assert_eq!(before.len(), 1);

    delete_task_impl(&conn, task_id).expect("delete task");

    let after = list_sessions_in_range_impl(&pool, "2026-11-04", "2026-11-04")
        .await
        .expect("list sessions");
    assert!(
        after.is_empty(),
        "删掉的任务不该再出现在今天的安排里"
    );
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM task_sessions").await,
        1,
        "排期数据本身还在，恢复后要能回来"
    );

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn restore_task_brings_the_task_and_its_sessions_back() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;
    insert_session(&pool, task_id, "2026-11-04").await;

    delete_task_impl(&conn, task_id).expect("delete task");
    restore_task_impl(&conn, task_id).expect("restore task");

    let deleted_at: Option<String> = sqlx::query_scalar("SELECT deleted_at FROM tasks WHERE id = ?1")
        .bind(task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(deleted_at.is_none(), "恢复后要清掉删除标记");

    let plan = list_tasks_impl(&conn, false).expect("list tasks");
    assert_eq!(plan.len(), 1, "恢复后任务回到计划里");
    assert_eq!(plan[0].id, task_id);

    let sessions = list_sessions_in_range_impl(&pool, "2026-11-04", "2026-11-04")
        .await
        .expect("list sessions");
    assert_eq!(sessions.len(), 1, "恢复后排期原样回来");

    let trash = list_deleted_tasks_impl(&conn).expect("list deleted tasks");
    assert!(trash.is_empty(), "恢复后回收站里不该还有它");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn restore_task_keeps_the_archived_flag_it_had() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;
    sqlx::query("UPDATE tasks SET archived = 1 WHERE id = ?1")
        .bind(task_id)
        .execute(&pool)
        .await
        .unwrap();

    delete_task_impl(&conn, task_id).expect("delete task");
    restore_task_impl(&conn, task_id).expect("restore task");

    let archived: i64 = sqlx::query_scalar("SELECT archived FROM tasks WHERE id = ?1")
        .bind(task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(archived, 1, "恢复的是删除前的状态，不是强行放回计划");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn delete_task_keeps_other_tasks_untouched() {
    let (path, pool, conn) = open_shared().await;
    let keep_id = insert_task(&pool, "物理必修二").await;
    let drop_id = insert_task(&pool, "数学必修一").await;
    let keep_session = insert_session(&pool, keep_id, "2026-11-05").await;
    let drop_session = insert_session(&pool, drop_id, "2026-11-04").await;
    insert_log(&pool, keep_session).await;
    insert_log(&pool, drop_session).await;

    delete_task_impl(&conn, drop_id).expect("delete task");

    assert_eq!(count(&pool, "SELECT COUNT(*) FROM tasks").await, 2);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_sessions").await, 2);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM actual_logs").await, 2);

    let title: String = sqlx::query_scalar("SELECT title FROM tasks WHERE id = ?1")
        .bind(keep_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(title, "物理必修二");

    let keep_deleted: Option<String> =
        sqlx::query_scalar("SELECT deleted_at FROM tasks WHERE id = ?1")
            .bind(keep_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(keep_deleted.is_none(), "别的任务不该被一起删掉");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn delete_task_rejects_an_unknown_id() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;
    insert_session(&pool, task_id, "2026-11-04").await;

    let err = delete_task_impl(&conn, 9999).expect_err("未知任务应报错");
    assert!(err.contains("不存在"), "错误信息要说明任务不存在：{err}");

    // 失败时什么都没动。
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM tasks").await, 1);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_sessions").await, 1);
    let deleted_at: Option<String> = sqlx::query_scalar("SELECT deleted_at FROM tasks WHERE id = ?1")
        .bind(task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(deleted_at.is_none());

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn delete_task_rejects_a_task_that_is_already_in_the_trash() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;

    delete_task_impl(&conn, task_id).expect("第一次删除");
    let err = delete_task_impl(&conn, task_id).expect_err("重复删除应报错");
    assert!(
        err.contains("回收站"),
        "错误信息要说明它已经在回收站里了：{err}"
    );

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn restore_task_rejects_a_task_that_is_not_in_the_trash() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;

    let err = restore_task_impl(&conn, task_id).expect_err("没删过的任务不该能恢复");
    assert!(
        err.contains("回收站"),
        "错误信息要说明它不在回收站里：{err}"
    );

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn delete_task_does_not_roll_back_xp() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;
    let session_id = insert_session(&pool, task_id, "2026-11-04").await;
    insert_log(&pool, session_id).await;

    sqlx::query("UPDATE user_stats SET total_xp = 120 WHERE id = 1")
        .execute(&pool)
        .await
        .unwrap();

    delete_task_impl(&conn, task_id).expect("delete task");

    // 历史不回退：学过的就是学过了。
    let xp: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(xp, 120);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn deleted_task_cannot_be_scheduled() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;

    delete_task_impl(&conn, task_id).expect("delete task");

    let err = create_session_impl(
        &pool,
        task_id,
        "2026-11-08".into(),
        "09:00".into(),
        "10:00".into(),
        None,
        Some(2),
    )
    .await
    .expect_err("回收站里的任务不该能排期");

    assert!(
        matches!(err, SessionError::TaskDeleted { task_id: id } if id == task_id),
        "expected TaskDeleted {{ task_id: {task_id} }}, got {err:?}"
    );

    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM task_sessions").await,
        0,
        "被拒绝的排期不能落库"
    );

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn purge_task_removes_the_task_and_everything_hanging_off_it() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;
    let session_id = insert_session(&pool, task_id, "2026-11-04").await;
    insert_log(&pool, session_id).await;
    insert_point(&pool, task_id).await;

    delete_task_impl(&conn, task_id).expect("进回收站");
    purge_task_impl(&conn, task_id).expect("彻底清除");

    // 这次是真的抹掉：任务、排期、流水、考点一行不剩。
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM tasks").await, 0);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_sessions").await, 0);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM actual_logs").await, 0);
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM task_knowledge_points").await,
        0,
        "考点随任务级联删除"
    );

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn purge_task_rejects_a_task_that_is_not_in_the_trash() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;

    let err = purge_task_impl(&conn, task_id).expect_err("计划里的任务不该能彻底清除");
    assert!(
        err.contains("回收站"),
        "错误信息要说明得先移入回收站：{err}"
    );

    // 拒绝时什么都没删。
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM tasks").await, 1);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_sessions").await, 0);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn purge_task_rejects_an_unknown_id() {
    let (path, _pool, conn) = open_shared().await;

    let err = purge_task_impl(&conn, 9999).expect_err("未知任务应报错");
    assert!(err.contains("不存在"), "错误信息要说明任务不存在：{err}");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn purge_task_keeps_other_tasks_untouched() {
    let (path, pool, conn) = open_shared().await;
    let keep_id = insert_task(&pool, "物理必修二").await;
    let drop_id = insert_task(&pool, "数学必修一").await;
    let keep_session = insert_session(&pool, keep_id, "2026-11-05").await;
    let drop_session = insert_session(&pool, drop_id, "2026-11-04").await;
    insert_log(&pool, keep_session).await;
    insert_log(&pool, drop_session).await;

    delete_task_impl(&conn, drop_id).expect("进回收站");
    purge_task_impl(&conn, drop_id).expect("彻底清除");

    assert_eq!(count(&pool, "SELECT COUNT(*) FROM tasks").await, 1);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_sessions").await, 1);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM actual_logs").await, 1);

    let title: String = sqlx::query_scalar("SELECT title FROM tasks WHERE id = ?1")
        .bind(keep_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(title, "物理必修二");

    let keep_deleted: Option<String> =
        sqlx::query_scalar("SELECT deleted_at FROM tasks WHERE id = ?1")
            .bind(keep_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(keep_deleted.is_none(), "别的任务不该被一起清除");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn purge_task_unlinks_rescheduled_sessions_before_removing_them() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;
    let original = insert_session(&pool, task_id, "2026-11-04").await;
    let replacement = insert_session(&pool, task_id, "2026-11-05").await;

    sqlx::query("UPDATE task_sessions SET rescheduled_to = ?1 WHERE id = ?2")
        .bind(replacement)
        .bind(original)
        .execute(&pool)
        .await
        .unwrap();

    delete_task_impl(&conn, task_id).expect("进回收站");
    purge_task_impl(&conn, task_id).expect("彻底清除");

    assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_sessions").await, 0);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn purge_task_unlinks_other_tasks_sessions_that_point_into_it() {
    let (path, pool, conn) = open_shared().await;
    let target = insert_task(&pool, "数学必修一").await;
    let other = insert_task(&pool, "物理必修二").await;
    let target_session = insert_session(&pool, target, "2026-11-04").await;
    let other_session = insert_session(&pool, other, "2026-11-05").await;

    // 别的任务的排期改期到了本任务的排期上（跨任务的 rescheduled_to）。
    sqlx::query("UPDATE task_sessions SET rescheduled_to = ?1 WHERE id = ?2")
        .bind(target_session)
        .bind(other_session)
        .execute(&pool)
        .await
        .unwrap();

    delete_task_impl(&conn, target).expect("进回收站");
    // 少了「先断开 rescheduled_to」这一步，这里会 FOREIGN KEY constraint failed。
    purge_task_impl(&conn, target).expect("彻底清除");

    let still_linked: Option<i64> =
        sqlx::query_scalar("SELECT rescheduled_to FROM task_sessions WHERE id = ?1")
            .bind(other_session)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(still_linked, None, "别的任务指向本任务的排期要断开");
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_sessions").await, 1);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn purge_task_does_not_roll_back_xp_or_streak() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;
    let session_id = insert_session(&pool, task_id, "2026-11-04").await;
    insert_log(&pool, session_id).await;

    sqlx::query(
        "UPDATE user_stats SET total_xp = 120, current_streak = 3, longest_streak = 5 WHERE id = 1",
    )
    .execute(&pool)
    .await
    .unwrap();

    delete_task_impl(&conn, task_id).expect("进回收站");
    purge_task_impl(&conn, task_id).expect("彻底清除");

    // 历史不回退：XP / 连击是全局账本，不属于某个任务。
    let (xp, streak, longest): (i64, i64, i64) = sqlx::query_as(
        "SELECT total_xp, current_streak, longest_streak FROM user_stats WHERE id = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(xp, 120);
    assert_eq!(streak, 3);
    assert_eq!(longest, 5);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn deleted_task_cannot_be_fetched_by_id() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;

    delete_task_impl(&conn, task_id).expect("delete task");

    let err = fetch_task_impl(&conn, task_id).expect_err("回收站里的任务不该按 id 读到");
    assert!(err.contains("回收站"), "错误信息要点名回收站：{err}");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn deleted_task_cannot_be_archived() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;

    delete_task_impl(&conn, task_id).expect("delete task");

    let err = archive_task_impl(&conn, task_id, true).expect_err("回收站里的任务不该能搁置");
    assert!(err.contains("回收站"), "错误信息要点名回收站：{err}");

    let archived: i64 = sqlx::query_scalar("SELECT archived FROM tasks WHERE id = ?1")
        .bind(task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(archived, 0, "归档位不能被改动");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn deleted_task_cannot_advance_its_round() {
    let (path, pool, conn) = open_shared().await;
    let task_id = insert_task(&pool, "数学必修一").await;

    delete_task_impl(&conn, task_id).expect("delete task");

    let err = advance_round_impl(&pool, task_id)
        .await
        .expect_err("回收站里的任务不该能推进轮次");
    assert!(
        matches!(err, SessionError::TaskDeleted { task_id: id } if id == task_id),
        "expected TaskDeleted {{ task_id: {task_id} }}, got {err:?}"
    );

    let round: i64 = sqlx::query_scalar("SELECT current_round FROM tasks WHERE id = ?1")
        .bind(task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(round, 1, "轮次不能被推进");

    let _ = std::fs::remove_file(&path);
}