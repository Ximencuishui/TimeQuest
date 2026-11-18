-- 错题本：记下做错的题、错因和正确思路，订正后打勾。
-- `subject` 是科目，`title` 是题目/知识点的简述，`reason` 是错因分类，
-- `correct_note` 是自己写下的正确思路（可空）。
-- `is_mastered` = 1 表示已经订正过、复习时会跳过。
CREATE TABLE IF NOT EXISTS mistakes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject      TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  reason       TEXT NOT NULL DEFAULT '',
  correct_note TEXT NOT NULL DEFAULT '',
  is_mastered  INTEGER NOT NULL DEFAULT 0 CHECK (is_mastered IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_mistakes_mastered ON mistakes(is_mastered);
