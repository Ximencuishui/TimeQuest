-- Global key-value settings for the v1.1 gamification UI.
-- `datetime('now')` is the column default this migration specifies (UTC).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
