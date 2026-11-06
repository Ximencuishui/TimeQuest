use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: i64,
    pub title: String,
    #[serde(rename = "type")]
    pub task_type: String,
    pub subject: Option<String>,
    pub textbook: Option<String>,
    pub unit_name: String,
    pub total_units: Option<i64>,
    pub total_rounds: i64,
    pub current_round: i64,
    pub color: Option<String>,
    pub archived: i64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_units_sum: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskPayload {
    pub title: String,
    #[serde(rename = "type")]
    pub task_type: String,
    pub subject: Option<String>,
    pub textbook: Option<String>,
    pub unit_name: Option<String>,
    pub total_units: Option<i64>,
    pub total_rounds: Option<i64>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTaskPayload {
    pub title: Option<String>,
    pub subject: Option<String>,
    pub textbook: Option<String>,
    pub unit_name: Option<String>,
    pub total_units: Option<i64>,
    pub total_rounds: Option<i64>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskSession {
    pub id: i64,
    pub task_id: i64,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub round: i64,
    pub status: String,
    pub planned_units: i64,
    pub actual_units: i64,
    pub self_rating: Option<i64>,
    pub self_note: Option<String>,
    pub rescheduled_to: Option<i64>,
    pub xp_awarded: i64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionPayload {
    pub task_id: i64,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub round: Option<i64>,
    pub planned_units: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteSessionInput {
    pub session_id: i64,
    pub actual_units: i64,
    pub self_rating: i64,
    pub self_note: Option<String>,
    pub method: Option<String>,
    pub defer_remaining: Option<bool>,
    pub defer_date: Option<String>,
    pub defer_start: Option<String>,
    pub defer_end: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RescheduleInput {
    pub session_id: i64,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteSessionResult {
    pub session: TaskSession,
    pub xp_awarded: i64,
    pub new_achievements: Vec<String>,
    /// New session from reschedule, or remainder spawn (same as remainder when partial).
    pub created_session_id: Option<i64>,
    /// Session created for leftover units when `move_remainder` is true.
    #[serde(default)]
    pub remainder_session_id: Option<i64>,
}

/// Optional slot for leftover units after a partial complete.
#[derive(Debug, Clone)]
pub struct RemainderSchedule {
    pub date: String,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActualLog {
    pub id: i64,
    pub date: String,
    pub start_at: Option<String>,
    pub end_at: Option<String>,
    pub duration_min: i64,
    pub subject: Option<String>,
    pub method: Option<String>,
    pub tag_type: String,
    pub session_id: Option<i64>,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLogPayload {
    pub date: String,
    pub start_at: Option<String>,
    pub end_at: Option<String>,
    pub duration_min: Option<i64>,
    pub subject: Option<String>,
    pub method: Option<String>,
    pub tag_type: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: i64,
    pub content: String,
    pub color: String,
    pub pinned: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNotePayload {
    pub content: Option<String>,
    pub color: Option<String>,
    pub pinned: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserStats {
    pub id: i64,
    pub total_xp: i64,
    pub current_level: i64,
    pub current_streak: i64,
    pub longest_streak: i64,
    pub last_done_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserAchievement {
    pub achievement_id: String,
    pub unlocked_at: String,
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanVsActualRow {
    pub subject: String,
    pub planned_min: i64,
    pub actual_min: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MethodShareRow {
    pub method: String,
    pub duration_min: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagTypeRow {
    pub tag_type: String,
    pub duration_min: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRate {
    pub done: i64,
    pub missed: i64,
    pub rescheduled: i64,
    pub rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvgRatingRow {
    pub key: String,
    pub avg_rating: f64,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskProgress {
    pub round_units: i64,
    pub total_units_done: i64,
}

/// One local day of completed units. Days with no `done` session are omitted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyUnitsRow {
    pub date: String,
    pub units: i64,
}

fn score_chinese() -> i64 {
    120
}
fn score_math() -> i64 {
    130
}
fn score_english() -> i64 {
    120
}
fn score_science() -> i64 {
    80
}

/// Per-subject gaokao goals. Stored as one JSON object on `user_profile`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SubjectTargets {
    #[serde(default = "score_chinese")]
    pub chinese: i64,
    #[serde(default = "score_math")]
    pub math: i64,
    #[serde(default = "score_english")]
    pub english: i64,
    #[serde(default = "score_science")]
    pub physics: i64,
    #[serde(default = "score_science")]
    pub chemistry: i64,
    #[serde(default = "score_science")]
    pub biology: i64,
}

impl Default for SubjectTargets {
    fn default() -> Self {
        Self {
            chinese: score_chinese(),
            math: score_math(),
            english: score_english(),
            physics: score_science(),
            chemistry: score_science(),
            biology: score_science(),
        }
    }
}

impl SubjectTargets {
    pub fn sum(&self) -> i64 {
        self.chinese + self.math + self.english + self.physics + self.chemistry + self.biology
    }
}

/// Singleton row `user_profile.id = 1`. `avatar` is a data URL or a local path.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserProfile {
    pub avatar: Option<String>,
    pub grade: String,
    pub region: String,
    pub total_target: i64,
    pub subject_targets: SubjectTargets,
}

impl Default for UserProfile {
    fn default() -> Self {
        let subject_targets = SubjectTargets::default();
        Self {
            avatar: None,
            grade: "高三".to_string(),
            region: String::new(),
            total_target: subject_targets.sum(),
            subject_targets,
        }
    }
}

/// One sitting. A missing subject score is `None` (that paper was not taken).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExamRecord {
    pub id: i64,
    pub exam_name: String,
    pub exam_date: String,
    pub chinese_score: Option<i64>,
    pub math_score: Option<i64>,
    pub english_score: Option<i64>,
    pub physics_score: Option<i64>,
    pub chemistry_score: Option<i64>,
    pub biology_score: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateExamRecordPayload {
    pub exam_name: String,
    pub exam_date: String,
    #[serde(default)]
    pub chinese_score: Option<i64>,
    #[serde(default)]
    pub math_score: Option<i64>,
    #[serde(default)]
    pub english_score: Option<i64>,
    #[serde(default)]
    pub physics_score: Option<i64>,
    #[serde(default)]
    pub chemistry_score: Option<i64>,
    #[serde(default)]
    pub biology_score: Option<i64>,
}
