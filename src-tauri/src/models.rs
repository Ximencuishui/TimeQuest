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
    /// 移入回收站的时间戳。`None` = 任务还在计划里；
    /// `Some` = 已删除，用户可以在回收站里随时找回。
    pub deleted_at: Option<String>,
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
    /// Unit label of the owning task ("课" / "节"). Kept next to the session so
    /// the UI can say "计划 2 节" without guessing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_unit_name: Option<String>,
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
    /// This completion pushed the main task's current round from below `total_units` to at or above it.
    #[serde(default)]
    pub is_task_fully_completed: bool,
    /// `user_stats.current_streak` after this call. Unchanged when the streak was not updated.
    #[serde(default)]
    pub current_streak: i64,
    /// 7, 14, or 30 only when this completion moved the streak onto that value.
    #[serde(default)]
    pub streak_milestone: Option<i64>,
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
    /// 绑定的日期（`YYYY-MM-DD`）；没绑定就是空。
    pub note_date: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNotePayload {
    pub content: Option<String>,
    pub color: Option<String>,
    pub pinned: Option<bool>,
    /// `None` = 不改；`Some("")` = 取消绑定；`Some("2026-11-18")` = 绑定到该日。
    pub note_date: Option<String>,
}

/// 错题本里的一条错题。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mistake {
    pub id: i64,
    /// 科目，空串表示还没归类。
    pub subject: String,
    /// 题目 / 知识点的简述。
    pub title: String,
    /// 错因分类，见 `MISTAKE_REASONS`。
    pub reason: String,
    /// 自己写下的正确思路，可空。
    pub correct_note: String,
    /// 1 = 已订正。
    pub is_mastered: i64,
    /// 上游知识点 id（知识图谱），比如 `cnm_001`。没挂知识点的错题没有。
    pub graph_topic_id: Option<String>,
    /// 图谱学科代号，比如 `math`。跟 `graph_topic_id` 同进同出。
    pub graph_subject: Option<String>,
    /// 知识点的名字。跟着 id 一起存下，错题列表不用再拉整包图谱。
    pub graph_topic_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 挂在某个图谱知识点上的一条错题。
///
/// 字段名跟 [`Mistake`] 一模一样（snake_case）。这俩是同一条错题的两种视图，
/// 字段名一旦分叉，前端就得记两套读法，很容易读错一边。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopicMistake {
    pub id: i64,
    pub subject: String,
    pub title: String,
    pub reason: String,
    pub correct_note: String,
    /// 1 = 已订正。
    pub is_mastered: i64,
    pub created_at: String,
}

/// 某个知识点上的错题汇总。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopicMistakes {
    pub topic_id: String,
    /// 图谱里的知识点名。图谱读不到时是空串。
    pub topic_name: String,
    /// 错题总数。
    pub total: i64,
    /// 还没订正的条数。
    pub pending: i64,
    pub items: Vec<TopicMistake>,
}

/// 新建一条错题的请求体。
///
/// 字段名跟 `UpdateMistakePayload` 一致（camelCase），两个接口写法统一。
/// 图谱那三个字段用结构体装而不是平铺参数：三个相邻的 `Option<String>`
/// 传错顺序编译器抓不到，而它们本来就必须是一组的。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMistakePayload {
    pub subject: String,
    pub title: String,
    pub reason: String,
    pub correct_note: String,
    /// 上游知识点 id（知识图谱）。不挂知识点就是 null。
    pub graph_topic_id: Option<String>,
    /// 图谱学科代号。
    pub graph_subject: Option<String>,
    /// 知识点名字。
    pub graph_topic_name: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMistakePayload {
    pub subject: Option<String>,
    pub title: Option<String>,
    pub reason: Option<String>,
    pub correct_note: Option<String>,
    /// 0 = 未订正，1 = 已订正。
    pub is_mastered: Option<i64>,
    /// 上游知识点 id。`None` 表示不改这一项。
    pub graph_topic_id: Option<String>,
    /// 图谱学科代号。`None` 表示不改这一项。
    pub graph_subject: Option<String>,
    /// 知识点名字。`None` 表示不改这一项。
    pub graph_topic_name: Option<String>,
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
