-- TimeQuest schema v1

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('main','side')),
  subject       TEXT,
  textbook      TEXT,
  unit_name     TEXT DEFAULT '课',
  total_units   INTEGER,
  total_rounds  INTEGER DEFAULT 1,
  current_round INTEGER DEFAULT 1,
  color         TEXT,
  archived      INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS task_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         INTEGER NOT NULL REFERENCES tasks(id),
  date            TEXT NOT NULL,
  start_time      TEXT NOT NULL,
  end_time        TEXT NOT NULL,
  round           INTEGER DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'planned'
                  CHECK(status IN ('planned','done','missed','rescheduled')),
  planned_units   INTEGER DEFAULT 0,
  actual_units    INTEGER DEFAULT 0,
  self_rating     INTEGER,
  self_note       TEXT,
  rescheduled_to  INTEGER REFERENCES task_sessions(id),
  xp_awarded      INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS actual_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,
  start_at     TEXT,
  end_at       TEXT,
  duration_min INTEGER NOT NULL,
  subject      TEXT,
  method       TEXT,
  tag_type     TEXT NOT NULL DEFAULT 'study'
               CHECK(tag_type IN ('study','sport','game','other')),
  session_id   INTEGER REFERENCES task_sessions(id),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  content    TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT 'yellow',
  pinned     INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS user_stats (
  id               INTEGER PRIMARY KEY CHECK(id = 1),
  total_xp         INTEGER DEFAULT 0,
  current_level    INTEGER DEFAULT 1,
  current_streak   INTEGER DEFAULT 0,
  longest_streak   INTEGER DEFAULT 0,
  last_done_date   TEXT
);

CREATE TABLE IF NOT EXISTS achievements (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS user_achievements (
  achievement_id TEXT PRIMARY KEY REFERENCES achievements(id),
  unlocked_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_date ON task_sessions(date);
CREATE INDEX IF NOT EXISTS idx_sessions_task ON task_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_logs_date ON actual_logs(date);
CREATE INDEX IF NOT EXISTS idx_logs_session ON actual_logs(session_id);

INSERT OR IGNORE INTO user_stats (id) VALUES (1);

INSERT OR IGNORE INTO achievements (id, name, description) VALUES
  ('first_round', '首轮完成', '某主线任务当前轮进度达标'),
  ('comeback', '逆风翻盘', '改期后完成且自评≥4星'),
  ('balanced', '均衡发展', '一周内主线与副本均有完成'),
  ('streak_5', '持续在场', '连续5天有完成记录');
