//! 排期建议：先修还没学完就排了后面的提醒（M3）。
//!
//! 纯读侧：不动任何表，只把踩到先修门槛的排期列出来。
//! 先修关系来自图谱插件的边，所以这里用一份假插件目录喂可控的先修数据。

mod common;

use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use timequest_lib::{
    list_task_prerequisite_conflicts_impl, PrerequisiteConflict, CONFLICT_ORDER_SWAPPED,
    CONFLICT_PREREQUISITE_TASK_INCOMPLETE,
};

/// 假插件 id。跟真插件不同名，就不会读到内置那份数学数据。
const PLUGIN_ID: &str = "test-graph";

/// 图谱里的三个点：`t_advanced` 的硬先修是 `t_basic`，`t_soft` 的软先修是 `t_basic`。
const TOPICS: &str = r#"{"topics":[
    {"id":"t_advanced","name":"三角函数"},
    {"id":"t_basic","name":"函数"},
    {"id":"t_soft","name":"数轴"}
]}"#;

/// 先修边：一硬一软。
const DEPENDENCIES: &str = r#"{"dependencies":[
    {"topicId":"t_advanced","prerequisiteId":"t_basic","strength":"hard","reason":"先会函数"},
    {"topicId":"t_soft","prerequisiteId":"t_basic","strength":"soft","reason":"有帮助"}
]}"#;

/// 造一个假插件目录，里面放一份可控的图谱。
fn fake_plugin_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("timequest-graph-{}", uuid::Uuid::new_v4()));
    let resources = dir.join(PLUGIN_ID).join("resources");
    std::fs::create_dir_all(&resources).expect("create resources dir");
    std::fs::write(resources.join("topics.math.json"), TOPICS).expect("write topics");
    std::fs::write(resources.join("dependencies.math.json"), DEPENDENCIES).expect("write deps");
    dir
}

/// 一个空的插件目录。用来验「学科包读不到就降级」。
fn empty_plugin_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("timequest-graph-empty-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("create empty dir");
    dir
}

/// 建一个数学主线任务。
async fn seed_task(pool: &SqlitePool, title: &str, total_units: i64) -> i64 {
    let inserted = sqlx::query(
        "INSERT INTO tasks (title, type, subject, total_units, total_rounds, current_round)
         VALUES (?1, 'main', '数学', ?2, 1, 1)",
    )
    .bind(title)
    .bind(total_units)
    .execute(pool)
    .await
    .expect("insert task");
    inserted.last_insert_rowid()
}

/// 挂一个图谱考点。位置自己定，才能造出顺序颠倒。
async fn add_graph_point(
    pool: &SqlitePool,
    task_id: i64,
    topic_id: &str,
    name: &str,
    position: i64,
) {
    sqlx::query(
        "INSERT INTO task_knowledge_points
           (task_id, section_name, name, is_mastered, position, graph_topic_id, graph_subject)
         VALUES (?1, '数学', ?2, 0, ?3, ?4, 'math')",
    )
    .bind(task_id)
    .bind(name)
    .bind(position)
    .bind(topic_id)
    .execute(pool)
    .await
    .expect("insert graph point");
}

/// 排一场课。
async fn add_session(
    pool: &SqlitePool,
    task_id: i64,
    date: &str,
    status: &str,
    actual_units: i64,
) {
    sqlx::query(
        "INSERT INTO task_sessions
           (task_id, date, start_time, end_time, round, status, planned_units, actual_units)
         VALUES (?1, ?2, '09:00', '10:00', 1, ?3, 1, ?4)",
    )
    .bind(task_id)
    .bind(date)
    .bind(status)
    .bind(actual_units)
    .execute(pool)
    .await
    .expect("insert session");
}

/// 查某个任务的排期建议。
async fn conflicts(
    pool: &SqlitePool,
    dir: &Path,
    task_id: i64,
) -> Vec<PrerequisiteConflict> {
    list_task_prerequisite_conflicts_impl(pool, dir, PLUGIN_ID, task_id)
        .await
        .expect("list conflicts")
}

/// 同一个任务里，先修考点排在了后面，要点出来。
#[tokio::test]
async fn order_swapped_conflict_is_reported() {
    let pool = common::setup().await;
    let dir = fake_plugin_dir();
    let task_id = seed_task(&pool, "三角函数", 10).await;

    // 先修「函数」在后面（position 1），依赖它的「三角函数」在前面。
    add_graph_point(&pool, task_id, "t_advanced", "三角函数", 0).await;
    add_graph_point(&pool, task_id, "t_basic", "函数", 1).await;

    let found = conflicts(&pool, &dir, task_id).await;

    assert_eq!(found.len(), 1, "顺序颠倒要报一条：{found:?}");
    assert_eq!(found[0].kind, CONFLICT_ORDER_SWAPPED);
    assert_eq!(found[0].topic_id, "t_advanced");
    assert_eq!(found[0].topic_name, "三角函数");
    assert_eq!(found[0].prerequisite_id, "t_basic");
    assert_eq!(found[0].prerequisite_name, "函数");
    assert_eq!(found[0].strength, "hard");
    assert_eq!(found[0].prerequisite_task_id, Some(task_id));
    assert!(
        found[0].message.contains("三角函数") && found[0].message.contains("函数"),
        "提示要说清是哪个考点：{}",
        found[0].message
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// 先修排在前面就是对的，不报。
#[tokio::test]
async fn prerequisite_before_dependent_is_not_a_conflict() {
    let pool = common::setup().await;
    let dir = fake_plugin_dir();
    let task_id = seed_task(&pool, "三角函数", 10).await;

    add_graph_point(&pool, task_id, "t_basic", "函数", 0).await;
    add_graph_point(&pool, task_id, "t_advanced", "三角函数", 1).await;

    let found = conflicts(&pool, &dir, task_id).await;

    assert!(found.is_empty(), "顺序对了不该报：{found:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 先修在另一个任务里，那边没学完，而这边已经先开课，要报。
#[tokio::test]
async fn incomplete_prerequisite_task_is_reported() {
    let pool = common::setup().await;
    let dir = fake_plugin_dir();

    let prerequisite_task = seed_task(&pool, "函数基础", 10).await;
    add_graph_point(&pool, prerequisite_task, "t_basic", "函数", 0).await;
    add_session(&pool, prerequisite_task, "2026-12-01", "planned", 0).await;

    let dependent_task = seed_task(&pool, "三角函数进阶", 10).await;
    add_graph_point(&pool, dependent_task, "t_advanced", "三角函数", 0).await;
    add_session(&pool, dependent_task, "2026-11-20", "planned", 0).await;

    let found = conflicts(&pool, &dir, dependent_task).await;

    assert_eq!(found.len(), 1, "先修没学完就排后面要报：{found:?}");
    assert_eq!(found[0].kind, CONFLICT_PREREQUISITE_TASK_INCOMPLETE);
    assert_eq!(found[0].prerequisite_task_id, Some(prerequisite_task));
    assert_eq!(
        found[0].prerequisite_task_title.as_deref(),
        Some("函数基础")
    );
    assert_eq!(
        found[0].prerequisite_task_remaining,
        Some(10),
        "还差多少要算出来"
    );
    assert_eq!(found[0].dependent_session_date.as_deref(), Some("2026-11-20"));
    assert_eq!(
        found[0].prerequisite_session_date.as_deref(),
        Some("2026-12-01")
    );
    assert!(
        found[0].message.contains("11月20日"),
        "提示里要把开课日期写成看得懂的样子：{}",
        found[0].message
    );

    // 先修那个任务自己查，没有自己依赖自己，不该报。
    let reverse = conflicts(&pool, &dir, prerequisite_task).await;
    assert!(reverse.is_empty(), "先修任务自己不该报：{reverse:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 先修任务已经学完了，不报。
#[tokio::test]
async fn finished_prerequisite_task_is_not_a_conflict() {
    let pool = common::setup().await;
    let dir = fake_plugin_dir();

    let prerequisite_task = seed_task(&pool, "函数基础", 10).await;
    add_graph_point(&pool, prerequisite_task, "t_basic", "函数", 0).await;
    add_session(&pool, prerequisite_task, "2026-11-01", "done", 10).await;

    let dependent_task = seed_task(&pool, "三角函数进阶", 10).await;
    add_graph_point(&pool, dependent_task, "t_advanced", "三角函数", 0).await;
    add_session(&pool, dependent_task, "2026-11-20", "planned", 0).await;

    let found = conflicts(&pool, &dir, dependent_task).await;

    assert!(found.is_empty(), "先修学完了就不该报：{found:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 先修考点压根不在任何任务里，不报——那是「还没排」，不是「排后面」。
#[tokio::test]
async fn prerequisite_in_no_task_is_not_a_conflict() {
    let pool = common::setup().await;
    let dir = fake_plugin_dir();

    let task_id = seed_task(&pool, "三角函数进阶", 10).await;
    add_graph_point(&pool, task_id, "t_advanced", "三角函数", 0).await;
    add_session(&pool, task_id, "2026-11-20", "planned", 0).await;

    let found = conflicts(&pool, &dir, task_id).await;

    assert!(found.is_empty(), "先修没排进任何任务就不该报：{found:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 软边是「会了有帮助」，不是门槛，不报。
#[tokio::test]
async fn soft_prerequisite_is_not_a_conflict() {
    let pool = common::setup().await;
    let dir = fake_plugin_dir();
    let task_id = seed_task(&pool, "数轴", 10).await;

    // 「数轴」的软先修是「函数」。软边即使顺序反了也不报。
    add_graph_point(&pool, task_id, "t_soft", "数轴", 0).await;
    add_graph_point(&pool, task_id, "t_basic", "函数", 1).await;

    let found = conflicts(&pool, &dir, task_id).await;

    assert!(found.is_empty(), "软边不该报：{found:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 任务里没有图谱考点，返回空列表。
#[tokio::test]
async fn task_without_graph_points_has_no_conflicts() {
    let pool = common::setup().await;
    let dir = fake_plugin_dir();
    let task_id = seed_task(&pool, "数学一轮", 10).await;

    sqlx::query(
        "INSERT INTO task_knowledge_points (task_id, section_name, name, is_mastered, position)
         VALUES (?1, '第一章', '有理数', 0, 0)",
    )
    .bind(task_id)
    .execute(&pool)
    .await
    .expect("insert custom point");

    let found = conflicts(&pool, &dir, task_id).await;

    assert!(found.is_empty(), "没有图谱考点就不该报：{found:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 学科包读不到时降级成空列表，不能报错挡住页面。
#[tokio::test]
async fn missing_pack_degrades_to_empty_conflicts() {
    let pool = common::setup().await;
    let dir = empty_plugin_dir();
    let task_id = seed_task(&pool, "三角函数", 10).await;

    add_graph_point(&pool, task_id, "t_advanced", "三角函数", 0).await;
    add_graph_point(&pool, task_id, "t_basic", "函数", 1).await;

    let found = list_task_prerequisite_conflicts_impl(&pool, &dir, PLUGIN_ID, task_id)
        .await
        .expect("读不到图谱也要返回，不能炸");

    assert!(found.is_empty(), "读不到图谱就当没冲突：{found:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 本任务比先修任务晚开课，顺序没错，不报。
#[tokio::test]
async fn later_dependent_task_is_not_a_conflict() {
    let pool = common::setup().await;
    let dir = fake_plugin_dir();

    let prerequisite_task = seed_task(&pool, "函数基础", 10).await;
    add_graph_point(&pool, prerequisite_task, "t_basic", "函数", 0).await;
    add_session(&pool, prerequisite_task, "2026-11-10", "planned", 0).await;

    let dependent_task = seed_task(&pool, "三角函数进阶", 10).await;
    add_graph_point(&pool, dependent_task, "t_advanced", "三角函数", 0).await;
    add_session(&pool, dependent_task, "2026-12-20", "planned", 0).await;

    let found = conflicts(&pool, &dir, dependent_task).await;

    assert!(found.is_empty(), "先学先修再学后面的，不该报：{found:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 同一个图谱考点被多个任务收着：那个任务学完了就不报。
#[tokio::test]
async fn shared_prerequisite_in_finished_task_is_not_a_conflict() {
    let pool = common::setup().await;
    let dir = fake_plugin_dir();

    // 两个任务都收了「函数」这个图谱考点。
    let finished = seed_task(&pool, "函数基础", 10).await;
    add_graph_point(&pool, finished, "t_basic", "函数", 0).await;
    add_session(&pool, finished, "2026-11-01", "done", 10).await;

    let unfinished = seed_task(&pool, "函数补强", 10).await;
    add_graph_point(&pool, unfinished, "t_basic", "函数", 0).await;
    add_session(&pool, unfinished, "2026-12-05", "planned", 0).await;

    let dependent_task = seed_task(&pool, "三角函数进阶", 10).await;
    add_graph_point(&pool, dependent_task, "t_advanced", "三角函数", 0).await;
    add_session(&pool, dependent_task, "2026-11-20", "planned", 0).await;

    let found = conflicts(&pool, &dir, dependent_task).await;

    assert_eq!(found.len(), 1, "还有一个任务没学完，要报那一个：{found:?}");
    assert_eq!(found[0].prerequisite_task_id, Some(unfinished));
    assert_eq!(found[0].prerequisite_task_remaining, Some(10));

    let _ = std::fs::remove_dir_all(&dir);
}

/// 副本任务没有「按单元推进」的概念，进度口径对不上，不报。
#[tokio::test]
async fn side_task_is_not_a_conflict() {
    let pool = common::setup().await;
    let dir = fake_plugin_dir();

    let inserted = sqlx::query(
        "INSERT INTO tasks (title, type, subject, total_units, total_rounds, current_round)
         VALUES ('函数副本', 'side', '数学', NULL, 1, 1)",
    )
    .execute(&pool)
    .await
    .expect("insert side task");
    let prerequisite_task = inserted.last_insert_rowid();
    add_graph_point(&pool, prerequisite_task, "t_basic", "函数", 0).await;
    add_session(&pool, prerequisite_task, "2026-12-01", "planned", 0).await;

    let dependent_task = seed_task(&pool, "三角函数进阶", 10).await;
    add_graph_point(&pool, dependent_task, "t_advanced", "三角函数", 0).await;
    add_session(&pool, dependent_task, "2026-11-20", "planned", 0).await;

    let found = conflicts(&pool, &dir, dependent_task).await;

    assert!(found.is_empty(), "副本任务口径对不上，不该报：{found:?}");

    let _ = std::fs::remove_dir_all(&dir);
}
