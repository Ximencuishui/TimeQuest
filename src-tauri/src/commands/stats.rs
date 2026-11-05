use crate::db::{with_db, DbState};
use crate::models::{
    AvgRatingRow, CompletionRate, MethodShareRow, PlanVsActualRow, TagTypeRow, UserAchievement,
    UserStats,
};
use chrono::NaiveDate;
use rusqlite::params;
use sqlx::SqlitePool;
use tauri::State;

/// Pad a parseable `Y-M-D` bound to `YYYY-MM-DD` (`"2026-1-1"` → `"2026-01-01"`).
/// Unparseable text is left unchanged, same policy as `normalize_hhmm`.
fn normalize_stats_date(raw: &str) -> String {
    let parts: Vec<&str> = raw.split('-').collect();
    if parts.len() != 3 {
        return raw.to_string();
    }
    let Ok(year) = parts[0].parse::<i32>() else {
        return raw.to_string();
    };
    let Ok(month) = parts[1].parse::<u32>() else {
        return raw.to_string();
    };
    let Ok(day) = parts[2].parse::<u32>() else {
        return raw.to_string();
    };
    NaiveDate::from_ymd_opt(year, month, day)
        .map(|date| date.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| raw.to_string())
}

fn stats_bounds(from: &str, to: &str) -> (String, String) {
    (normalize_stats_date(from), normalize_stats_date(to))
}

#[tauri::command]
pub fn get_user_stats(state: State<'_, DbState>) -> Result<UserStats, String> {
    with_db(&state, |conn| {
        conn.query_row(
            "SELECT id, total_xp, current_level, current_streak, longest_streak, last_done_date FROM user_stats WHERE id=1",
            [],
            |r| {
                Ok(UserStats {
                    id: r.get(0)?,
                    total_xp: r.get(1)?,
                    current_level: r.get(2)?,
                    current_streak: r.get(3)?,
                    longest_streak: r.get(4)?,
                    last_done_date: r.get(5)?,
                })
            },
        )
        .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn list_user_achievements(
    state: State<'_, DbState>,
) -> Result<Vec<UserAchievement>, String> {
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT ua.achievement_id, ua.unlocked_at, a.name, a.description
                 FROM user_achievements ua
                 JOIN achievements a ON a.id = ua.achievement_id
                 ORDER BY ua.unlocked_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(UserAchievement {
                    achievement_id: r.get(0)?,
                    unlocked_at: r.get(1)?,
                    name: r.get(2)?,
                    description: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

pub async fn stats_plan_vs_actual_impl(
    db: &SqlitePool,
    from: &str,
    to: &str,
) -> Result<Vec<PlanVsActualRow>, String> {
    let (from, to) = stats_bounds(from, to);
    // Minute totals only. Callers must not divide actual by planned; planned_min may be 0.
    let rows = sqlx::query_as::<_, (String, i64, i64)>(
        r#"
        WITH planned AS (
          SELECT COALESCE(t.subject, '未分类') AS subject,
                 SUM(
                   CASE
                     WHEN length(s.start_time) >= 5 AND length(s.end_time) >= 5
                     THEN (
                       CAST(substr(s.end_time,1,2) AS INTEGER)*60 + CAST(substr(s.end_time,4,2) AS INTEGER)
                       - (CAST(substr(s.start_time,1,2) AS INTEGER)*60 + CAST(substr(s.start_time,4,2) AS INTEGER))
                     )
                     ELSE 0
                   END
                 ) AS planned_min
          FROM task_sessions s
          JOIN tasks t ON t.id = s.task_id
          WHERE s.date >= ? AND s.date <= ?
            AND s.status IN ('planned','done','missed','rescheduled')
          GROUP BY COALESCE(t.subject, '未分类')
        ),
        actual AS (
          SELECT COALESCE(subject, '未分类') AS subject,
                 SUM(duration_min) AS actual_min
          FROM actual_logs
          WHERE date >= ? AND date <= ? AND tag_type = 'study'
          GROUP BY COALESCE(subject, '未分类')
        ),
        keys AS (
          SELECT subject FROM planned
          UNION
          SELECT subject FROM actual
        )
        SELECT k.subject,
               COALESCE(p.planned_min, 0) AS planned_min,
               COALESCE(a.actual_min, 0) AS actual_min
        FROM keys k
        LEFT JOIN planned p ON p.subject = k.subject
        LEFT JOIN actual a ON a.subject = k.subject
        ORDER BY k.subject
        "#,
    )
    .bind(&from)
    .bind(&to)
    .bind(&from)
    .bind(&to)
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(subject, planned_min, actual_min)| PlanVsActualRow {
            subject,
            planned_min,
            actual_min,
        })
        .collect())
}

#[tauri::command]
pub async fn stats_plan_vs_actual(
    pool: State<'_, SqlitePool>,
    from: String,
    to: String,
) -> Result<Vec<PlanVsActualRow>, String> {
    stats_plan_vs_actual_impl(pool.inner(), &from, &to).await
}

pub async fn stats_method_share_impl(
    db: &SqlitePool,
    from: &str,
    to: &str,
) -> Result<Vec<MethodShareRow>, String> {
    let (from, to) = stats_bounds(from, to);
    let rows = sqlx::query_as::<_, (String, i64)>(
        "SELECT COALESCE(method,'未填') AS method, SUM(duration_min) AS duration_min
         FROM actual_logs
         WHERE date >= ?1 AND date <= ?2 AND tag_type = 'study'
         GROUP BY COALESCE(method,'未填')
         ORDER BY duration_min DESC",
    )
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(method, duration_min)| MethodShareRow {
            method,
            duration_min,
        })
        .collect())
}

#[tauri::command]
pub async fn stats_method_share(
    pool: State<'_, SqlitePool>,
    from: String,
    to: String,
) -> Result<Vec<MethodShareRow>, String> {
    stats_method_share_impl(pool.inner(), &from, &to).await
}

pub async fn stats_tag_type_totals_impl(
    db: &SqlitePool,
    from: &str,
    to: &str,
) -> Result<Vec<TagTypeRow>, String> {
    let (from, to) = stats_bounds(from, to);
    let rows = sqlx::query_as::<_, (String, i64)>(
        "SELECT tag_type, SUM(duration_min) AS duration_min
         FROM actual_logs
         WHERE date >= ?1 AND date <= ?2
         GROUP BY tag_type",
    )
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(tag_type, duration_min)| TagTypeRow {
            tag_type,
            duration_min,
        })
        .collect())
}

#[tauri::command]
pub async fn stats_tag_type_totals(
    pool: State<'_, SqlitePool>,
    from: String,
    to: String,
) -> Result<Vec<TagTypeRow>, String> {
    stats_tag_type_totals_impl(pool.inner(), &from, &to).await
}

pub async fn stats_completion_rate_impl(
    db: &SqlitePool,
    from: &str,
    to: &str,
) -> Result<CompletionRate, String> {
    let (from, to) = stats_bounds(from, to);
    let done = session_status_count(db, &from, &to, "done").await?;
    let missed = session_status_count(db, &from, &to, "missed").await?;
    let rescheduled = session_status_count(db, &from, &to, "rescheduled").await?;
    let denom = done + missed + rescheduled;
    let rate = if denom == 0 {
        0.0
    } else {
        done as f64 / denom as f64
    };
    Ok(CompletionRate {
        done,
        missed,
        rescheduled,
        rate,
    })
}

async fn session_status_count(
    db: &SqlitePool,
    from: &str,
    to: &str,
    status: &str,
) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM task_sessions WHERE date >= ?1 AND date <= ?2 AND status = ?3",
    )
    .bind(from)
    .bind(to)
    .bind(status)
    .fetch_one(db)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stats_completion_rate(
    pool: State<'_, SqlitePool>,
    from: String,
    to: String,
) -> Result<CompletionRate, String> {
    stats_completion_rate_impl(pool.inner(), &from, &to).await
}

#[tauri::command]
pub fn stats_avg_ratings(
    state: State<'_, DbState>,
    from: String,
    to: String,
) -> Result<Vec<AvgRatingRow>, String> {
    let from = normalize_stats_date(&from);
    let to = normalize_stats_date(&to);
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT COALESCE(t.subject, t.title) AS key,
                        AVG(s.self_rating * 1.0) AS avg_rating,
                        COUNT(*) AS count
                 FROM task_sessions s
                 JOIN tasks t ON t.id = s.task_id
                 WHERE s.date >= ?1 AND s.date <= ?2
                   AND s.status = 'done' AND s.self_rating IS NOT NULL
                 GROUP BY COALESCE(t.subject, t.title)
                 ORDER BY avg_rating DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![from, to], |r| {
                Ok(AvgRatingRow {
                    key: r.get(0)?,
                    avg_rating: r.get(1)?,
                    count: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}
