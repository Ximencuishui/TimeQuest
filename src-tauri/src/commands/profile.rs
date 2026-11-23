use crate::db::{with_db, DbState};
use crate::models::UserProfile;
use rusqlite::{params, Connection};
use tauri::State;

const AVATAR_MAX_CHARS: usize = 2_000_000;

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
///
/// 3.x 留下来的那列「各科目标」不再由这里写入：4.0 起各科目标在 `subjects` 表里，
/// 这里不再写它（列有默认值，插入时自动填）。
pub fn ensure_user_profile(conn: &Connection) -> Result<(), String> {
    conn.execute(
        r#"INSERT OR IGNORE INTO user_profile (id, avatar, grade, region, total_target)
           VALUES (1, NULL, ?1, ?2, ?3)"#,
        params![
            UserProfile::default().grade,
            UserProfile::default().region,
            UserProfile::default().total_target,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn read_profile(conn: &Connection) -> Result<UserProfile, String> {
    let (avatar, grade, region, total_target): (
        Option<String>,
        String,
        String,
        i64,
    ) = conn
        .query_row(
            "SELECT avatar, grade, region, total_target FROM user_profile WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                ))
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                "user_profile 缺失，数据损坏（需要 id=1 单例行）".to_string()
            }
            other => other.to_string(),
        })?;
    Ok(UserProfile {
        avatar: empty_to_none(avatar),
        grade,
        region,
        total_target,
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
    conn.execute(
        r#"UPDATE user_profile SET
             avatar = ?1,
             grade = ?2,
             region = ?3,
             total_target = ?4,
             updated_at = datetime('now','localtime')
           WHERE id = 1"#,
        params![
            profile.avatar,
            profile.grade,
            profile.region,
            profile.total_target,
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
    conn.execute(
        r#"INSERT INTO user_profile (id, avatar, grade, region, total_target, updated_at)
           VALUES (1, ?1, ?2, ?3, ?4, COALESCE(?5, datetime('now','localtime')))
           ON CONFLICT(id) DO UPDATE SET
             avatar = excluded.avatar,
             grade = excluded.grade,
             region = excluded.region,
             total_target = excluded.total_target,
             updated_at = excluded.updated_at"#,
        params![
            profile.avatar,
            profile.grade,
            profile.region,
            profile.total_target,
            updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Build a profile from an export object. Missing `id` means 1. `id != 1` is rejected.
///
/// 3.x 备份里的那列「各科目标」不再进档案：它只在导入时用来回填 `subjects.goal`。
pub fn user_profile_from_export(
    value: &serde_json::Value,
) -> Result<(UserProfile, Option<String>), String> {
    if let Some(id) = value.get("id").and_then(|v| v.as_i64()) {
        if id != 1 {
            return Err(format!("user_profile.id must be 1 (singleton), got {id}"));
        }
    }
    let defaults = UserProfile::default();
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
