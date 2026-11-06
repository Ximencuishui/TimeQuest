-- Singleton profile. Subject goals live in `subject_targets` JSON so a new
-- subject is a struct field, not a migration. Defaults sum to 610:
-- 语文 120 + 数学 130 + 英语 120 + 物理 80 + 化学 80 + 生物 80.
CREATE TABLE IF NOT EXISTS user_profile (
  id               INTEGER PRIMARY KEY CHECK(id = 1),
  avatar           TEXT,
  grade            TEXT NOT NULL DEFAULT '高三',
  region           TEXT NOT NULL DEFAULT '',
  total_target     INTEGER NOT NULL DEFAULT 610,
  subject_targets  TEXT NOT NULL DEFAULT '{"chinese":120,"math":130,"english":120,"physics":80,"chemistry":80,"biology":80}',
  updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

INSERT OR IGNORE INTO user_profile (id) VALUES (1);
