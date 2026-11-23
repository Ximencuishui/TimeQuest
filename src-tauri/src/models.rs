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
///
/// 4.0 起各科目标落在 `subjects` 表、总分目标落在 `goals.target_score`，
/// 档案只留头像 / 年级 / 地区这类上下文信息。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserProfile {
    pub avatar: Option<String>,
    pub grade: String,
    pub region: String,
    pub total_target: i64,
}

impl Default for UserProfile {
    fn default() -> Self {
        Self {
            avatar: None,
            grade: "高三".to_string(),
            region: String::new(),
            total_target: 610,
        }
    }
}

/// 科目字典里的一科。
///
/// 4.0 起成绩按科目逐行存，科目集合由赛道决定，不再写死六科。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Subject {
    pub id: i64,
    /// 稳定标识，如 `chinese`。前端拿它当 key。
    pub key: String,
    /// 显示名，如「语文」。
    pub label: String,
    /// 满分，可空（不按满分折算的赛道可以不填）。
    pub full_mark: Option<f64>,
    /// 目标分，可空。
    pub goal: Option<f64>,
    /// 计量单位，如「分」。可空。
    pub unit: Option<String>,
    /// 排序序号，越小越靠前。
    pub order_index: i64,
    /// 所属赛道。可空（还没归到任何赛道下的历史行）。
    pub track_id: Option<i64>,
}

/// 新建 / 修改一科的请求体。
///
/// `id` 有值就是改这一科，没有就是新建。`key` 不传就按 label 生成一个。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSubjectPayload {
    pub id: Option<i64>,
    /// 所属赛道。
    pub track_id: Option<i64>,
    /// 稳定标识。新建时必填。
    pub key: Option<String>,
    /// 显示名。
    pub label: String,
    pub full_mark: Option<f64>,
    pub goal: Option<f64>,
    pub unit: Option<String>,
    pub order_index: Option<i64>,
}

/// 一条赛道：一种学习方向。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    /// 赛道名称，如「高考」。
    pub name: String,
    /// 赛道类型：`exam` / `skill` / `course`。
    pub kind: String,
    /// 计分方式：`total` / `per_subject` / `band`。
    pub score_mode: String,
    /// 是不是当前主赛道。全库最多一个。
    pub is_primary: bool,
    /// 主题色，可空。
    pub color: Option<String>,
    pub created_at: String,
}

/// 新建 / 修改一条赛道的请求体。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpsertTrackPayload {
    pub id: Option<i64>,
    pub name: String,
    /// 不传就沿用旧值 / 默认值。
    pub kind: Option<String>,
    pub score_mode: Option<String>,
    pub is_primary: Option<bool>,
    pub color: Option<String>,
}

/// 一场考试里的一科成绩。
///
/// `score` 为 `None` 表示这场没考这科（不是 0 分）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExamScore {
    pub id: i64,
    pub exam_id: i64,
    pub subject_id: i64,
    pub score: Option<f64>,
}

/// 一次考试场次。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExamSession {
    pub id: i64,
    /// 所属赛道。`tracks` 表要等 P1-2 才建，先允许为空。
    pub track_id: Option<i64>,
    /// 场次名称，如「一模」。
    pub name: String,
    /// 考试日期，`YYYY-MM-DD`。
    pub date: String,
    pub created_at: String,
}

/// 一次考试场次 + 它的各科成绩。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExamSessionWithScores {
    pub id: i64,
    pub track_id: Option<i64>,
    pub name: String,
    pub date: String,
    pub created_at: String,
    /// 各科成绩。没考的科目也会有一行，`score` 为 `None`。
    pub scores: Vec<ExamScore>,
}

/// 录入成绩时的一科。`score` 为 `None` 表示这场没考这科。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExamScoreInput {
    pub subject_key: String,
    pub score: Option<f64>,
}

/// 新建一次考试场次 + 各科成绩。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateExamSessionPayload {
    pub track_id: Option<i64>,
    pub name: String,
    pub date: String,
    pub scores: Vec<ExamScoreInput>,
}

/// 一条倒计时目标。
///
/// 目标以前只存在浏览器 localStorage 里，导出 JSON 带不走；
/// 4.0 起落到 `goals` 表，导出导入才能原样还原。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: i64,
    /// 所属赛道。`tracks` 表要等 P1-2 才建，先允许为空。
    pub track_id: Option<i64>,
    /// 目标名称，如「高考」「一模」。
    pub name: String,
    /// 目标日期，`YYYY-MM-DD`。
    pub date: String,
    /// 目标类型：`exam` / `milestone` / `deadline`。
    pub kind: String,
    /// 是不是主目标。全库最多一个主目标。
    pub is_primary: bool,
    /// 目标分数，可空。
    pub target_score: Option<f64>,
    pub created_at: String,
}

/// 新建 / 修改一条目标的请求体。
///
/// `id` 有值就是改这一条，没有就是新建。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpsertGoalPayload {
    pub id: Option<i64>,
    pub track_id: Option<i64>,
    pub name: String,
    pub date: String,
    /// 不填按 `exam` 处理。
    pub kind: Option<String>,
    /// 置成 true 时，其它目标同时降为普通目标。
    pub is_primary: Option<bool>,
    pub target_score: Option<f64>,
}
