use crate::error::TextbookError;
use crate::pdf_outline::{extract_outline, outline_to_textbook};
use crate::textbooks::{
    get_textbook_outline as load_builtin_outline, outline_sections, parse_textbook_json,
    validate_outline, TextbookOutline,
};
use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::State;

/// 教材导入的默认时段池：一天最多三场，彼此不重叠。
///
/// 防呆：以前所有章节都塞进同一天同一个时段，结果 16 个排期挤在 19:00–20:00，
/// 今日计划直接崩掉。这里改成跨天铺排，一天最多三场。
const SESSION_SLOTS: [(&str, &str); 3] = [
    ("08:00", "09:00"),
    ("14:00", "15:00"),
    ("19:00", "20:00"),
];

const DEFAULT_COLOR: &str = "#F97316";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GenerateTasksFromOutlineInput {
    pub subject: String,
    pub version: String,
    pub volume: String,
    pub task_name: String,
    /// Section titles the student already knows. Matched after trim, in any order.
    pub selected_sections: Vec<String>,
    /// When false, insert the main task and its knowledge points, and no `task_sessions`.
    pub auto_schedule: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerateTasksResult {
    pub task_id: i64,
    pub total_units: i64,
    pub planned_count: i64,
    pub done_count: i64,
    /// 排期铺到的最后一天（`YYYY-MM-DD`）；没有待学排期时为空。
    pub last_planned_date: Option<String>,
}

/// 一节教材在排期表里的落位。
struct PlannedSection<'a> {
    name: &'a str,
    date: String,
    start_time: &'static str,
    end_time: &'static str,
    mastered: bool,
}

/// 把章节铺成排期：待学的从今天开始，每天最多 `SESSION_SLOTS.len()` 场。
///
/// - 已掌握的章节记在今天的晚间回顾格（`status = 'done'`），不占用未来的学习位。
/// - 待学的章节按教材顺序铺开，一天一格往下推，不会出现同一天同一时段的堆叠。
fn plan_sections<'a>(
    sections: &[&'a str],
    mastered: &HashSet<String>,
    start_date: NaiveDate,
) -> Vec<PlannedSection<'a>> {
    let mut planned = Vec::with_capacity(sections.len());
    let mut next_slot = 0usize;
    let today = start_date.format("%Y-%m-%d").to_string();
    for section in sections {
        let is_mastered = mastered.contains(*section);
        let (date, start_time, end_time) = if is_mastered {
            // 已掌握：记在今天的回顾格，不占用未来排期位。
            let slot = SESSION_SLOTS[SESSION_SLOTS.len() - 1];
            (today.clone(), slot.0, slot.1)
        } else {
            let day = next_slot / SESSION_SLOTS.len();
            let slot = SESSION_SLOTS[next_slot % SESSION_SLOTS.len()];
            next_slot += 1;
            let date = start_date + chrono::Duration::days(day as i64);
            (date.format("%Y-%m-%d").to_string(), slot.0, slot.1)
        };
        planned.push(PlannedSection {
            name: section,
            date,
            start_time,
            end_time,
            mastered: is_mastered,
        });
    }
    planned
}

/// Create one main task from the outline of `(subject, version, volume)`.
///
/// `total_units` is the number of sections in that book. Knowledge points are
/// rows on `task_knowledge_points`, not extra tasks. Every section is written
/// in this transaction, before commit. A section in `selected_sections` marks
/// its points mastered (`is_mastered = 1`); the rest stay `0`.
///
/// When `auto_schedule` is false, the task and its knowledge points are inserted
/// and no `task_sessions` are created.
/// When it is true, every section becomes one session, spread across the
/// following days: at most one section per time slot per day
/// (`08:00–09:00`, `14:00–15:00`, `19:00–20:00`).
///
/// A section whose title is in `selected_sections` is already mastered:
/// `status = 'done'`, `actual_units = 1`, `xp_awarded = 0`. It is inserted
/// directly and does not go through `complete_session_impl`, so there is no XP,
/// no `actual_logs`, no streak change, and no achievement. Every other section
/// is `status = 'planned'`, `planned_units = 1`, `actual_units = 0`. The student
/// can reschedule those rows later.
///
/// `self_note` stores the section title until a later completion overwrites it.
pub async fn generate_tasks_from_outline_impl(
    db: &SqlitePool,
    input: GenerateTasksFromOutlineInput,
) -> Result<GenerateTasksResult, TextbookError> {
    let task_name = input.task_name.trim();
    if task_name.is_empty() {
        return Err(TextbookError::EmptyTitle);
    }
    let outline =
        resolve_textbook_outline(db, &input.subject, &input.version, &input.volume).await?;
    validate_outline(&outline)?;
    let sections = outline_sections(&outline);
    let mastered = normalize_selected(&input.selected_sections, &sections)?;

    let total_units = i64::try_from(sections.len())
        .map_err(|_| TextbookError::InvalidOutline("section count does not fit in i64".into()))?;
    let textbook = format!("{} {}", outline.version, outline.volume);
    let today = Local::now().date_naive();

    let mut tx = db.begin().await?;
    let task_id = sqlx::query(
        r#"INSERT INTO tasks (title, type, subject, textbook, unit_name, total_units, total_rounds, current_round, color)
           VALUES (?1, 'main', ?2, ?3, '节', ?4, 1, 1, ?5)"#,
    )
    .bind(task_name)
    .bind(&outline.subject)
    .bind(&textbook)
    .bind(total_units)
    .bind(DEFAULT_COLOR)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    for chapter in &outline.chapters {
        for section in &chapter.sections {
            let section_mastered = mastered.contains(section.name.as_str());
            for (index, point) in section.knowledge_points.iter().enumerate() {
                let name = point.trim();
                if name.is_empty() {
                    continue;
                }
                let position = i64::try_from(index).map_err(|_| {
                    TextbookError::InvalidOutline("knowledge point index does not fit in i64".into())
                })?;
                sqlx::query(
                    r#"INSERT INTO task_knowledge_points (task_id, section_name, name, is_mastered, position)
                       VALUES (?1, ?2, ?3, ?4, ?5)"#,
                )
                .bind(task_id)
                .bind(&section.name)
                .bind(name)
                .bind(if section_mastered { 1i64 } else { 0i64 })
                .bind(position)
                .execute(&mut *tx)
                .await?;
            }
        }
    }

    let mut planned_count = 0i64;
    let mut done_count = 0i64;
    let mut last_planned_date: Option<String> = None;
    if input.auto_schedule {
        for slot in plan_sections(&sections, &mastered, today) {
            let (status, actual_units) = if slot.mastered {
                done_count += 1;
                ("done", 1i64)
            } else {
                planned_count += 1;
                last_planned_date = Some(slot.date.clone());
                ("planned", 0i64)
            };
            sqlx::query(
                r#"INSERT INTO task_sessions (
                       task_id, date, start_time, end_time, round, status,
                       planned_units, actual_units, self_note, xp_awarded
                   ) VALUES (?1, ?2, ?3, ?4, 1, ?5, 1, ?6, ?7, 0)"#,
            )
            .bind(task_id)
            .bind(&slot.date)
            .bind(slot.start_time)
            .bind(slot.end_time)
            .bind(status)
            .bind(actual_units)
            .bind(slot.name)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;

    Ok(GenerateTasksResult {
        task_id,
        total_units,
        planned_count,
        done_count,
        last_planned_date,
    })
}

/// Section titles in `selected` must exist in the outline. Duplicates count once.
fn normalize_selected(
    selected: &[String],
    sections: &[&str],
) -> Result<HashSet<String>, TextbookError> {
    let known: HashSet<&str> = sections.iter().copied().collect();
    let mut mastered = HashSet::with_capacity(selected.len());
    for raw in selected {
        let name = raw.trim();
        if name.is_empty() || !known.contains(name) {
            return Err(TextbookError::UnknownSection {
                section: raw.trim().to_string(),
            });
        }
        mastered.insert(name.to_string());
    }
    Ok(mastered)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportTextbookResult {
    pub outline: TextbookOutline,
    pub replaced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextbookCatalogItem {
    pub subject: String,
    pub version: String,
    pub volume: String,
    /// `builtin` or `imported`. An import with the same key replaces the builtin at lookup.
    pub source: String,
}

/// Validate `json` and upsert it by `(subject, version, volume)`.
///
/// The desktop UI picks a local file and passes its text. This command does not
/// open a dialog; it rejects payloads that are not a chapter tree.
pub async fn import_textbook_json_impl(
    db: &SqlitePool,
    json: &str,
) -> Result<ImportTextbookResult, TextbookError> {
    let outline = parse_textbook_json(json)?;
    let canonical = serde_json::to_string(&outline)
        .map_err(|err| TextbookError::InvalidJson(err.to_string()))?;

    let mut tx = db.begin().await?;
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM imported_textbooks WHERE subject = ?1 AND version = ?2 AND volume = ?3",
    )
    .bind(&outline.subject)
    .bind(&outline.version)
    .bind(&outline.volume)
    .fetch_optional(&mut *tx)
    .await?;

    sqlx::query(
        r#"INSERT INTO imported_textbooks (subject, version, volume, outline_json)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(subject, version, volume) DO UPDATE SET
             outline_json = excluded.outline_json,
             updated_at = datetime('now','localtime')"#,
    )
    .bind(&outline.subject)
    .bind(&outline.version)
    .bind(&outline.volume)
    .bind(&canonical)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(ImportTextbookResult {
        replaced: existing.is_some(),
        outline,
    })
}

/// Imported row wins over a built-in book with the same key.
pub async fn resolve_textbook_outline(
    db: &SqlitePool,
    subject: &str,
    version: &str,
    volume: &str,
) -> Result<TextbookOutline, TextbookError> {
    let subject = subject.trim();
    let version = version.trim();
    let volume = volume.trim();
    let stored: Option<String> = sqlx::query_scalar(
        "SELECT outline_json FROM imported_textbooks WHERE subject = ?1 AND version = ?2 AND volume = ?3",
    )
    .bind(subject)
    .bind(version)
    .bind(volume)
    .fetch_optional(db)
    .await?;
    if let Some(json) = stored {
        return parse_textbook_json(&json);
    }
    load_builtin_outline(subject, version, volume)
}

pub async fn list_textbook_catalog_impl(
    db: &SqlitePool,
) -> Result<Vec<TextbookCatalogItem>, TextbookError> {
    let mut items = Vec::new();
    for book in crate::textbooks::builtin_outlines()? {
        items.push(TextbookCatalogItem {
            subject: book.subject,
            version: book.version,
            volume: book.volume,
            source: "builtin".into(),
        });
    }
    let imported: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT subject, version, volume FROM imported_textbooks ORDER BY subject, version, volume",
    )
    .fetch_all(db)
    .await?;
    for (subject, version, volume) in imported {
        if let Some(existing) = items.iter_mut().find(|item| {
            item.subject == subject && item.version == version && item.volume == volume
        }) {
            existing.source = "imported".into();
        } else {
            items.push(TextbookCatalogItem {
                subject,
                version,
                volume,
                source: "imported".into(),
            });
        }
    }
    Ok(items)
}

#[tauri::command]
pub async fn get_textbook_outline(
    pool: State<'_, SqlitePool>,
    subject: String,
    version: String,
    volume: String,
) -> Result<TextbookOutline, String> {
    resolve_textbook_outline(pool.inner(), &subject, &version, &volume)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn import_textbook_json(
    pool: State<'_, SqlitePool>,
    json: String,
) -> Result<ImportTextbookResult, String> {
    import_textbook_json_impl(pool.inner(), &json)
        .await
        .map_err(Into::into)
}

/// 从本地 PDF 的目录页解析出章节，存进教材库。
///
/// 解析出来的目录是「章 + 节」，没有细到知识点，所以知识点列表是空的，
/// 学生可以在任务详情里自己补。目录里的节标题会带上编号（`1.1 正数和负数`）。
///
/// PDF 里找不到目录页、或者目录里没有可用的章节时直接报错，
/// 不写一条空教材进库。
fn validate_import_pdf(file: &str) -> Result<PathBuf, String> {
    let file = file.trim();
    if file.is_empty() {
        return Err("教材文件路径不能为空".into());
    }
    let path = Path::new(file);
    let is_pdf = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"));
    if !is_pdf {
        return Err("只能导入 .pdf 文件".into());
    }
    if !path.is_file() {
        return Err("教材文件不存在或不是普通文件".into());
    }
    Ok(path.to_path_buf())
}

#[tauri::command]
pub async fn import_textbook_pdf(
    pool: State<'_, SqlitePool>,
    file: String,
    subject: String,
    version: String,
    volume: String,
) -> Result<ImportTextbookResult, String> {
    let path = validate_import_pdf(&file)?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|err| format!("读取教材文件失败：{err}"))?;
    // 明显不是 PDF 的内容直接拒绝，不让任意文本文件走到解析器里。
    if !bytes.windows(5).take(1024).any(|head| head == b"%PDF-") {
        return Err("不是有效的 PDF 文件".into());
    }
    let chapters = extract_outline(&bytes).map_err(|err| format!("解析教材目录失败：{err}"))?;
    let outline = outline_to_textbook(&chapters, &subject, &version, &volume)?;
    let json = serde_json::to_string(&outline).map_err(|err| err.to_string())?;
    import_textbook_json_impl(pool.inner(), &json)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_textbook_catalog(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<TextbookCatalogItem>, String> {
    list_textbook_catalog_impl(pool.inner())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_available_textbooks() -> Result<Vec<crate::textbooks::AvailableTextbook>, String> {
    crate::textbooks::list_available_textbooks().map_err(Into::into)
}

#[tauri::command]
pub async fn generate_tasks_from_outline(
    pool: State<'_, SqlitePool>,
    subject: String,
    version: String,
    volume: String,
    task_name: String,
    selected_sections: Vec<String>,
    auto_schedule: bool,
) -> Result<GenerateTasksResult, String> {
    generate_tasks_from_outline_impl(
        pool.inner(),
        GenerateTasksFromOutlineInput {
            subject,
            version,
            volume,
            task_name,
            selected_sections,
            auto_schedule,
        },
    )
    .await
    .map_err(Into::into)
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TaskKnowledgePoint {
    pub id: i64,
    pub task_id: i64,
    pub section_name: String,
    pub name: String,
    pub is_mastered: i64,
    pub position: i64,
    /// 上游知识点 id（知识图谱），比如 `cnm_001`。自写考点与教材考点是空。
    pub graph_topic_id: Option<String>,
    /// 图谱学科代号，比如 `math`。自写考点与教材考点是空。
    pub graph_subject: Option<String>,
}

const TASK_KNOWLEDGE_POINT_COLUMNS: &str =
    "id, task_id, section_name, name, is_mastered, position, graph_topic_id, graph_subject";

pub async fn get_task_knowledge_points_impl(
    db: &SqlitePool,
    task_id: i64,
) -> Result<Vec<TaskKnowledgePoint>, TextbookError> {
    let rows = sqlx::query_as::<_, TaskKnowledgePoint>(&format!(
        "SELECT {TASK_KNOWLEDGE_POINT_COLUMNS}
         FROM task_knowledge_points
         WHERE task_id = ?1
         ORDER BY id ASC"
    ))
    .bind(task_id)
    .fetch_all(db)
    .await?;
    Ok(rows)
}

/// Flip `is_mastered`. Checking a point sets it to 1; checking again clears it.
pub async fn toggle_knowledge_point_impl(
    db: &SqlitePool,
    id: i64,
) -> Result<TaskKnowledgePoint, TextbookError> {
    let changed = sqlx::query(
        "UPDATE task_knowledge_points
         SET is_mastered = CASE is_mastered WHEN 1 THEN 0 ELSE 1 END
         WHERE id = ?1",
    )
    .bind(id)
    .execute(db)
    .await?
    .rows_affected();
    if changed == 0 {
        return Err(TextbookError::KnowledgePointNotFound { id });
    }
    let row = sqlx::query_as::<_, TaskKnowledgePoint>(&format!(
        "SELECT {TASK_KNOWLEDGE_POINT_COLUMNS} FROM task_knowledge_points WHERE id = ?1"
    ))
    .bind(id)
    .fetch_one(db)
    .await?;
    Ok(row)
}

#[tauri::command]
pub async fn get_task_knowledge_points(
    pool: State<'_, SqlitePool>,
    task_id: i64,
) -> Result<Vec<TaskKnowledgePoint>, String> {
    get_task_knowledge_points_impl(pool.inner(), task_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn toggle_knowledge_point(
    pool: State<'_, SqlitePool>,
    id: i64,
) -> Result<TaskKnowledgePoint, String> {
    toggle_knowledge_point_impl(pool.inner(), id)
        .await
        .map_err(Into::into)
}

/// Insert one student-authored point. `is_mastered` stays 0. `position` is one
/// past the last point in the same section, or 0 when the section is new.
/// Names are trimmed and then stored unchanged: a section title taken from the
/// textbook outline is not rewritten, and a custom title is kept as typed.
/// A repeated `(task, section, name)` is rejected.
pub async fn add_custom_knowledge_point_impl(
    db: &SqlitePool,
    task_id: i64,
    section_name: String,
    name: String,
) -> Result<TaskKnowledgePoint, TextbookError> {
    insert_knowledge_point(db, task_id, section_name, name, None).await
}

/// Insert one point that points at an upstream knowledge-graph topic.
///
/// The upstream id (`cnm_001`) is stored next to the name, so later milestones
/// can look the prerequisite chain up without a separate mapping table. The
/// same topic cannot be added to one task twice; another task may reuse it.
///
/// The task layer does not check that the id exists upstream: the list the
/// student picked from comes from the graph itself.
pub async fn add_graph_knowledge_point_impl(
    db: &SqlitePool,
    task_id: i64,
    section_name: String,
    name: String,
    graph_topic_id: String,
    graph_subject: Option<String>,
) -> Result<TaskKnowledgePoint, TextbookError> {
    let topic_id = graph_topic_id.trim().to_string();
    if topic_id.is_empty() {
        return Err(TextbookError::EmptyGraphTopicId);
    }
    let subject = graph_subject
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    insert_knowledge_point(
        db,
        task_id,
        section_name,
        name,
        Some(GraphTopic {
            topic_id,
            subject,
        }),
    )
    .await
}

/// A knowledge point's link to the upstream knowledge graph.
struct GraphTopic {
    topic_id: String,
    subject: Option<String>,
}

/// Insert one knowledge point row. `graph` is `None` for textbook points and
/// student-authored points.
async fn insert_knowledge_point(
    db: &SqlitePool,
    task_id: i64,
    section_name: String,
    name: String,
    graph: Option<GraphTopic>,
) -> Result<TaskKnowledgePoint, TextbookError> {
    let section_name = section_name.trim().to_string();
    let name = name.trim().to_string();
    if section_name.is_empty() {
        return Err(TextbookError::EmptySectionName);
    }
    if name.is_empty() {
        return Err(TextbookError::EmptyKnowledgePointName);
    }
    let task_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM tasks WHERE id = ?1")
        .bind(task_id)
        .fetch_optional(db)
        .await?;
    if task_exists.is_none() {
        return Err(TextbookError::TaskNotFound { id: task_id });
    }
    // 同一个图谱考点在一个任务里只算一次。这里先查一遍，好把报错说清楚，
    // 而不是让唯一索引抛一个看不懂的数据库错误。
    if let Some(topic) = graph.as_ref() {
        let existing: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM task_knowledge_points WHERE task_id = ?1 AND graph_topic_id = ?2",
        )
        .bind(task_id)
        .bind(&topic.topic_id)
        .fetch_optional(db)
        .await?;
        if existing.is_some() {
            return Err(TextbookError::DuplicateGraphTopic);
        }
    }
    let position: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1) + 1
         FROM task_knowledge_points
         WHERE task_id = ?1 AND section_name = ?2",
    )
    .bind(task_id)
    .bind(&section_name)
    .fetch_one(db)
    .await?;
    let graph_topic_id = graph.as_ref().map(|topic| topic.topic_id.clone());
    let graph_subject = graph.as_ref().and_then(|topic| topic.subject.clone());
    let inserted = sqlx::query(
        r#"INSERT INTO task_knowledge_points
             (task_id, section_name, name, is_mastered, position, graph_topic_id, graph_subject)
           VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)"#,
    )
    .bind(task_id)
    .bind(&section_name)
    .bind(&name)
    .bind(position)
    .bind(graph_topic_id.as_deref())
    .bind(graph_subject.as_deref())
    .execute(db)
    .await
    .map_err(|err| {
        if err
            .as_database_error()
            .is_some_and(|db_err| db_err.is_unique_violation())
        {
            TextbookError::DuplicateKnowledgePoint
        } else {
            TextbookError::from(err)
        }
    })?;
    Ok(TaskKnowledgePoint {
        id: inserted.last_insert_rowid(),
        task_id,
        section_name,
        name,
        is_mastered: 0,
        position,
        graph_topic_id,
        graph_subject,
    })
}

pub async fn delete_knowledge_point_impl(db: &SqlitePool, id: i64) -> Result<(), TextbookError> {
    let changed = sqlx::query("DELETE FROM task_knowledge_points WHERE id = ?1")
        .bind(id)
        .execute(db)
        .await?
        .rows_affected();
    if changed == 0 {
        return Err(TextbookError::KnowledgePointNotFound { id });
    }
    Ok(())
}

#[tauri::command]
pub async fn add_custom_knowledge_point(
    pool: State<'_, SqlitePool>,
    task_id: i64,
    section_name: String,
    name: String,
    graph_topic_id: Option<String>,
    graph_subject: Option<String>,
) -> Result<TaskKnowledgePoint, String> {
    let db = pool.inner();
    let graph_topic_id = graph_topic_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    match graph_topic_id {
        Some(topic_id) => {
            add_graph_knowledge_point_impl(db, task_id, section_name, name, topic_id, graph_subject)
                .await
                .map_err(Into::into)
        }
        None => add_custom_knowledge_point_impl(db, task_id, section_name, name)
            .await
            .map_err(Into::into),
    }
}

#[tauri::command]
pub async fn delete_knowledge_point(
    pool: State<'_, SqlitePool>,
    id: i64,
) -> Result<(), String> {
    delete_knowledge_point_impl(pool.inner(), id)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::validate_import_pdf;

    #[test]
    fn import_pdf_rejects_non_pdf_and_missing_paths() {
        assert!(validate_import_pdf("").is_err());
        assert!(validate_import_pdf("book.txt").is_err());
        assert!(validate_import_pdf("missing.pdf").is_err());
    }

    #[test]
    fn import_pdf_accepts_real_pdf_path() {
        let path = std::env::temp_dir().join(format!(
            "timequest-import-{}.pdf",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, b"%PDF-1.4 test").expect("write temp pdf");
        let resolved = validate_import_pdf(path.to_string_lossy().as_ref()).expect("valid pdf");
        assert_eq!(resolved, path);
        std::fs::remove_file(path).ok();
    }
}
