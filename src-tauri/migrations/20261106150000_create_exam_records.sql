-- One row per exam sitting. Subject columns match `user_profile.subject_targets`.
-- NULL means that paper was not taken, not a score of zero.
CREATE TABLE IF NOT EXISTS exam_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_name       TEXT NOT NULL,
  exam_date       TEXT NOT NULL,
  chinese_score   INTEGER,
  math_score      INTEGER,
  english_score   INTEGER,
  physics_score   INTEGER,
  chemistry_score INTEGER,
  biology_score   INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_exam_records_date ON exam_records(exam_date);
