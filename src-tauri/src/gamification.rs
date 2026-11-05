use rusqlite::{params, Connection, OptionalExtension};

pub fn quality_multiplier(rating: i64) -> f64 {
    if rating >= 4 {
        1.2
    } else if rating == 3 {
        1.0
    } else if rating >= 1 {
        0.9
    } else {
        1.0
    }
}

pub fn streak_multiplier(streak_days: i64) -> f64 {
    if streak_days >= 30 {
        1.5
    } else if streak_days >= 14 {
        1.3
    } else if streak_days >= 7 {
        1.2
    } else if streak_days >= 3 {
        1.1
    } else {
        1.0
    }
}

pub fn base_unit_xp(task_type: &str) -> f64 {
    if task_type == "main" {
        12.0
    } else {
        10.0
    }
}

pub fn calc_session_xp(
    actual_units: i64,
    task_type: &str,
    self_rating: i64,
    streak_days: i64,
) -> i64 {
    if actual_units <= 0 {
        return 0;
    }
    let raw = actual_units as f64
        * base_unit_xp(task_type)
        * quality_multiplier(self_rating)
        * streak_multiplier(streak_days);
    raw.round() as i64
}

pub fn xp_required_for_level(level: i64) -> i64 {
    if level < 1 {
        return 100;
    }
    (100.0 * (level as f64).powf(1.5)).round() as i64
}

pub fn level_from_total_xp(total_xp: i64) -> i64 {
    let mut level = 1i64;
    let mut remaining = total_xp.max(0);
    loop {
        let need = xp_required_for_level(level);
        if remaining < need {
            return level;
        }
        remaining -= need;
        level += 1;
        if level > 999 {
            return 999;
        }
    }
}

pub fn update_streak_values(
    current: i64,
    longest: i64,
    last_done: Option<&str>,
    done_date: &str,
) -> (i64, i64, String) {
    if last_done == Some(done_date) {
        let cur = current.max(1);
        return (cur, longest.max(cur), done_date.to_string());
    }

    let mut next = 1i64;
    if let Some(last) = last_done {
        if let (Ok(last_d), Ok(done_d)) = (
            chrono::NaiveDate::parse_from_str(last, "%Y-%m-%d"),
            chrono::NaiveDate::parse_from_str(done_date, "%Y-%m-%d"),
        ) {
            let diff = (done_d - last_d).num_days();
            if diff == 1 {
                next = current + 1;
            } else if diff < 0 {
                return (
                    current,
                    longest,
                    last.to_string(),
                );
            }
        }
    }

    (next, longest.max(next), done_date.to_string())
}

#[allow(dead_code)]
pub fn apply_xp_and_streak(
    conn: &Connection,
    xp: i64,
    done_date: &str,
) -> Result<(), String> {
    let (total_xp, current_streak, longest_streak, last_done): (
        i64,
        i64,
        i64,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT total_xp, current_streak, longest_streak, last_done_date FROM user_stats WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| e.to_string())?;

    let (new_streak, new_longest, new_last) =
        update_streak_values(current_streak, longest_streak, last_done.as_deref(), done_date);
    let new_total = total_xp + xp;
    let new_level = level_from_total_xp(new_total);

    conn.execute(
        "UPDATE user_stats SET total_xp = ?1, current_level = ?2, current_streak = ?3, longest_streak = ?4, last_done_date = ?5 WHERE id = 1",
        params![new_total, new_level, new_streak, new_longest, new_last],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[allow(dead_code)]
pub fn try_unlock(
    conn: &Connection,
    achievement_id: &str,
) -> Result<bool, String> {
    let exists: Option<String> = conn
        .query_row(
            "SELECT achievement_id FROM user_achievements WHERE achievement_id = ?1",
            params![achievement_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if exists.is_some() {
        return Ok(false);
    }
    conn.execute(
        "INSERT INTO user_achievements (achievement_id) VALUES (?1)",
        params![achievement_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

pub const RESCHEDULE_RECOVERY_BONUS: i64 = 5;
