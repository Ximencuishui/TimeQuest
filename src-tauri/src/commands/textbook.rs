use crate::error::TextbookError;
use crate::textbooks::{
    get_textbook_outline as load_builtin_outline, outline_sections, parse_textbook_json,
    validate_outline, TextbookOutline,
};
use chrono::Local;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashSet;
use tauri::State;

const SESSION_START: &str = "19:00";
const SESSION_END: &str = "20:00";
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
/// When it is true, every section becomes one session dated today
/// (`YYYY-MM-DD` in local time), `19:00–20:00`.
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
    let today = Local::now().format("%Y-%m-%d").to_string();

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
    if input.auto_schedule {
        for section in &sections {
            let mastered_section = mastered.contains(*section);
            let (status, actual_units) = if mastered_section {
                done_count += 1;
                ("done", 1i64)
            } else {
                planned_count += 1;
                ("planned", 0i64)
            };
            sqlx::query(
                r#"INSERT INTO task_sessions (
                       task_id, date, start_time, end_time, round, status,
                       planned_units, actual_units, self_note, xp_awarded
                   ) VALUES (?1, ?2, ?3, ?4, 1, ?5, 1, ?6, ?7, 0)"#,
            )
            .bind(task_id)
            .bind(&today)
            .bind(SESSION_START)
            .bind(SESSION_END)
            .bind(status)
            .bind(actual_units)
            .bind(*section)
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
}

pub async fn get_task_knowledge_points_impl(
    db: &SqlitePool,
    task_id: i64,
) -> Result<Vec<TaskKnowledgePoint>, TextbookError> {
    let rows = sqlx::query_as::<_, TaskKnowledgePoint>(
        "SELECT id, task_id, section_name, name, is_mastered, position
         FROM task_knowledge_points
         WHERE task_id = ?1
         ORDER BY id ASC",
    )
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
    let row = sqlx::query_as::<_, TaskKnowledgePoint>(
        "SELECT id, task_id, section_name, name, is_mastered, position
         FROM task_knowledge_points WHERE id = ?1",
    )
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
    let position: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1) + 1
         FROM task_knowledge_points
         WHERE task_id = ?1 AND section_name = ?2",
    )
    .bind(task_id)
    .bind(&section_name)
    .fetch_one(db)
    .await?;
    let inserted = sqlx::query(
        r#"INSERT INTO task_knowledge_points (task_id, section_name, name, is_mastered, position)
           VALUES (?1, ?2, ?3, 0, ?4)"#,
    )
    .bind(task_id)
    .bind(&section_name)
    .bind(&name)
    .bind(position)
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
) -> Result<TaskKnowledgePoint, String> {
    add_custom_knowledge_point_impl(pool.inner(), task_id, section_name, name)
        .await
        .map_err(Into::into)
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
