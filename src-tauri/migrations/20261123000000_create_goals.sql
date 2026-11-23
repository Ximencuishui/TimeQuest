-- 倒计时目标落库。
--
-- 4.0 之前这些目标只存在浏览器 localStorage（timequest.exams）里，
-- 导出 JSON 导不出它，换机 / 恢复备份后目标会退回默认值。
--
-- track_id 先留空：tracks 表要等 P1-2 才建，这里不能带外键约束
-- （SQLite 建表时引用一张还不存在的表会直接报错）。
CREATE TABLE IF NOT EXISTS goals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id     INTEGER,
  name         TEXT NOT NULL,
  date         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'exam'
               CHECK(kind IN ('exam','milestone','deadline')),
  is_primary   INTEGER NOT NULL DEFAULT 0,
  target_score REAL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_goals_track ON goals(track_id);
