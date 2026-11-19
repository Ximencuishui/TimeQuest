use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("{0}")]
    Message(String),
}

impl From<AppError> for String {
    fn from(value: AppError) -> Self {
        value.to_string()
    }
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Message(s.into())
    }
}

/// Session-domain errors (scheduling / complete / reschedule).
#[derive(Debug, Error, PartialEq, Eq)]
pub enum SessionError {
    #[error("task {task_id} is archived and cannot be scheduled")]
    TaskArchived { task_id: i64 },

    #[error("task {task_id} not found")]
    TaskNotFound { task_id: i64 },

    /// `actual_units` must be `>= 0`. Enforced by the application layer
    /// (no DB `CHECK` on `task_sessions.actual_units`).
    #[error("actual_units must be >= 0, got {actual_units}")]
    InvalidActualUnits { actual_units: i64 },

    /// `actual_units = 0` with `move_remainder` is rejected: use reschedule instead of
    /// deferring a full planned remainder from a zero-progress complete.
    #[error("cannot defer remaining units when actual_units is 0; use reschedule instead")]
    ZeroUnitsCannotDefer,

    /// Only `planned` sessions can be completed (`done` is idempotent Ok).
    #[error("cannot complete session with status {status}")]
    InvalidCompleteStatus { status: String },

    /// `end_time` must be strictly after `start_time` on the same day.
    /// A reversed range ("20:00 → 10:00") is a typo, not a plan.
    #[error("结束时间不能早于开始时间（{start_time} → {end_time}），请检查排期时段")]
    InvalidTimeRange { start_time: String, end_time: String },

    /// Session bounds must be `HH:MM`-parseable.
    #[error("时间格式不对（{value}），请用 HH:MM 这样的时间，例如 19:00")]
    InvalidTimeFormat { value: String },

    #[error("排期不存在: {session_id}")]
    SessionNotFound { session_id: i64 },

    /// Only `planned` sessions can be deleted; finished history stays.
    #[error("只有「待完成」的排期可以删除，当前状态是 {status}")]
    SessionNotDeletable { status: String },

    /// A session with study logs is history — it cannot be deleted.
    #[error("这条排期已经有学习记录，不能删除")]
    SessionHasLogs { session_id: i64 },

    #[error("database error: {0}")]
    Db(String),

    #[error("{0}")]
    Message(String),
}

impl From<sqlx::Error> for SessionError {
    fn from(value: sqlx::Error) -> Self {
        Self::Db(value.to_string())
    }
}

impl From<SessionError> for String {
    fn from(value: SessionError) -> Self {
        value.to_string()
    }
}

/// Textbook catalog lookup and outline-to-task generation.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum TextbookError {
    #[error("textbook not found: {subject} / {version} / {volume}")]
    NotFound {
        subject: String,
        version: String,
        volume: String,
    },

    #[error("invalid textbook json: {0}")]
    InvalidJson(String),

    #[error("invalid outline: {0}")]
    InvalidOutline(String),

    #[error("task title must not be empty")]
    EmptyTitle,

    #[error("outline has no sections")]
    EmptyOutline,

    #[error("section is not in this textbook: {section}")]
    UnknownSection { section: String },

    #[error("database error: {0}")]
    Db(String),

    #[error("knowledge point not found: {id}")]
    KnowledgePointNotFound { id: i64 },

    #[error("考点名称不能为空")]
    EmptyKnowledgePointName,

    #[error("节名称不能为空")]
    EmptySectionName,

    #[error("这一节里已经有同名考点")]
    DuplicateKnowledgePoint,

    #[error("这个考点已经在列表里了")]
    DuplicateGraphTopic,

    #[error("知识图谱考点编号不能为空")]
    EmptyGraphTopicId,

    #[error("任务不存在: {id}")]
    TaskNotFound { id: i64 },
}

impl From<sqlx::Error> for TextbookError {
    fn from(value: sqlx::Error) -> Self {
        Self::Db(value.to_string())
    }
}

impl From<TextbookError> for String {
    fn from(value: TextbookError) -> Self {
        value.to_string()
    }
}
