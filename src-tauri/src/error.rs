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
