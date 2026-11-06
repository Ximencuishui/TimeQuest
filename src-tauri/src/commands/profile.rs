use crate::db::{with_db, DbState};
use crate::models::{SubjectTargets, UserProfile};
use rusqlite::{params, Connection};
use tauri::State;

const AVATAR_MAX_CHARS: usize = 2_000_000;

fn default_targets_json() -> String {
    serde_json::to_string(&SubjectTargets::default()).expect("default subject targets serialize")
}

fn empty_to_none(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

/// Insert the singleton when the table is empty. Existing rows stay untouched.
pub fn ensure_user_profile(conn: &Connection) -> Result<(), String> {
    conn.execute(
        r#"INSERT OR IGNORE INTO user_profile (id, avatar, grade, region, total_target, subject_targets)
           VALUES (1, NULL, ?1, ?2, ?3, ?4)"#,
        params![
            UserProfile::default().grade,
            UserProfile::default().region,
            UserProfile::default().total_target,
            default_targets_json(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn read_profile(conn: &Connection) -> Result<UserProfile, String> {
    let (avatar, grade, region, total_target, targets): (
        Option<String>,
        String,
        String,
        i64,
        String,
    ) = conn
        .query_row(
            "SELECT avatar, grade, region, total_target, subject_targets FROM user_profile WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                "user_profile 缺失，数据损坏（需要 id=1 单例行）".to_string()
            }
            other => other.to_string(),
        })?;
    let subject_targets = serde_json::from_str::<SubjectTargets>(&targets)
        .unwrap_or_else(|_| SubjectTargets::default());
    Ok(UserProfile {
        avatar: empty_to_none(avatar),
        grade,
        region,
        total_target,
        subject_targets,
    })
}

pub fn get_user_profile_impl(conn: &Connection) -> Result<UserProfile, String> {
    ensure_user_profile(conn)?;
    read_profile(conn)
}

fn validate_profile(profile: &UserProfile) -> Result<(), String> {
    if profile.total_target < 0 {
        return Err("总分目标不能为负数".to_string());
    }
    let scores = [
        ("语文", profile.subject_targets.chinese),
        ("数学", profile.subject_targets.math),
        ("英语", profile.subject_targets.english),
        ("物理", profile.subject_targets.physics),
        ("化学", profile.subject_targets.chemistry),
        ("生物", profile.subject_targets.biology),
    ];
    for (name, score) in scores {
        if score < 0 {
            return Err(format!("{name}目标不能为负数"));
        }
    }
    if profile
        .avatar
        .as_ref()
        .map(|value| value.len())
        .unwrap_or(0)
        > AVATAR_MAX_CHARS
    {
        return Err("头像过大，请换一张更小的图片".to_string());
    }
    Ok(())
}

pub fn update_user_profile_impl(
    conn: &Connection,
    mut profile: UserProfile,
) -> Result<UserProfile, String> {
    profile.grade = profile.grade.trim().to_string();
    profile.region = profile.region.trim().to_string();
    profile.avatar = empty_to_none(profile.avatar);
    validate_profile(&profile)?;
    ensure_user_profile(conn)?;
    let targets = serde_json::to_string(&profile.subject_targets).map_err(|e| e.to_string())?;
    conn.execute(
        r#"UPDATE user_profile SET
             avatar = ?1,
             grade = ?2,
             region = ?3,
             total_target = ?4,
             subject_targets = ?5,
             updated_at = datetime('now','localtime')
           WHERE id = 1"#,
        params![
            profile.avatar,
            profile.grade,
            profile.region,
            profile.total_target,
            targets,
        ],
    )
    .map_err(|e| e.to_string())?;
    read_profile(conn)
}

/// Write one singleton row. `updated_at = None` uses the column clock.
pub fn upsert_user_profile_row(
    conn: &Connection,
    profile: &UserProfile,
    updated_at: Option<&str>,
) -> Result<(), String> {
    let targets = serde_json::to_string(&profile.subject_targets).map_err(|e| e.to_string())?;
    conn.execute(
        r#"INSERT INTO user_profile (id, avatar, grade, region, total_target, subject_targets, updated_at)
           VALUES (1, ?1, ?2, ?3, ?4, ?5, COALESCE(?6, datetime('now','localtime')))
           ON CONFLICT(id) DO UPDATE SET
             avatar = excluded.avatar,
             grade = excluded.grade,
             region = excluded.region,
             total_target = excluded.total_target,
             subject_targets = excluded.subject_targets,
             updated_at = excluded.updated_at"#,
        params![
            profile.avatar,
            profile.grade,
            profile.region,
            profile.total_target,
            targets,
            updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Build a profile from an export object. Missing `id` means 1. `id != 1` is rejected.
pub fn user_profile_from_export(
    value: &serde_json::Value,
) -> Result<(UserProfile, Option<String>), String> {
    if let Some(id) = value.get("id").and_then(|v| v.as_i64()) {
        if id != 1 {
            return Err(format!("user_profile.id must be 1 (singleton), got {id}"));
        }
    }
    let defaults = UserProfile::default();
    let subject_targets = match value.get("subject_targets") {
        Some(serde_json::Value::String(raw)) => {
            serde_json::from_str(raw).unwrap_or_else(|_| SubjectTargets::default())
        }
        Some(other) => {
            serde_json::from_value(other.clone()).unwrap_or_else(|_| SubjectTargets::default())
        }
        None => SubjectTargets::default(),
    };
    let avatar = value
        .get("avatar")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let updated_at = value
        .get("updated_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Ok((
        UserProfile {
            avatar: empty_to_none(avatar),
            grade: value
                .get("grade")
                .and_then(|v| v.as_str())
                .unwrap_or(&defaults.grade)
                .to_string(),
            region: value
                .get("region")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            total_target: value
                .get("total_target")
                .and_then(|v| v.as_i64())
                .unwrap_or(defaults.total_target),
            subject_targets,
        },
        updated_at,
    ))
}

#[tauri::command]
pub fn get_user_profile(state: State<'_, DbState>) -> Result<UserProfile, String> {
    with_db(&state, get_user_profile_impl)
}

#[tauri::command]
pub fn update_user_profile(
    state: State<'_, DbState>,
    profile: UserProfile,
) -> Result<UserProfile, String> {
    with_db(&state, |conn| update_user_profile_impl(conn, profile))
}
