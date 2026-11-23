-- 4.0 成绩行化：一场考试一行场次，每科一行成绩。
--
-- 老表 `exam_records` 一行塞了六科分数，换赛道就装不下别的科目。
-- 这里拆成 `exam_sessions`（场次）+ `exam_scores`（成绩行）。
--
-- `subjects` 是科目字典。P1-1 只建骨架（还没有 track_id 列），
-- P1-2 再补赛道列并回填历史行。

CREATE TABLE IF NOT EXISTS subjects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  full_mark   REAL,
  goal        REAL,
  unit        TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_subjects_order ON subjects(order_index);

-- 六科种子。满分与设置页的默认目标一致（120/130/120/80/80/80，合计 610）。
INSERT OR IGNORE INTO subjects (key, label, full_mark, goal, unit, order_index) VALUES
  ('chinese',   '语文', 120, 120, '分', 0),
  ('math',      '数学', 130, 130, '分', 1),
  ('english',   '英语', 120, 120, '分', 2),
  ('physics',   '物理',  80,  80, '分', 3),
  ('chemistry', '化学',  80,  80, '分', 4),
  ('biology',   '生物',  80,  80, '分', 5);

-- 一行一次考试。
CREATE TABLE IF NOT EXISTS exam_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id   INTEGER,
  name       TEXT NOT NULL,
  date       TEXT NOT NULL,
  is_mock    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 一行一科。score 为 NULL 表示这场没考这科（不是 0 分）。
CREATE TABLE IF NOT EXISTS exam_scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id    INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  score      REAL,
  UNIQUE(exam_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_sessions_date ON exam_sessions(date);
CREATE INDEX IF NOT EXISTS idx_exam_scores_exam ON exam_scores(exam_id);

-- 旧表展开成场次 + 成绩行。id 对齐（exam_sessions.id = exam_records.id），方便回溯。
-- `exam_records` 保留不删，只读留档。
INSERT OR IGNORE INTO exam_sessions (id, name, date, is_mock, created_at)
SELECT id, exam_name, exam_date, COALESCE(is_mock, 0), created_at FROM exam_records;

INSERT OR IGNORE INTO exam_scores (exam_id, subject_id, score)
SELECT r.id, s.id, r.chinese_score FROM exam_records r JOIN subjects s ON s.key = 'chinese';

INSERT OR IGNORE INTO exam_scores (exam_id, subject_id, score)
SELECT r.id, s.id, r.math_score FROM exam_records r JOIN subjects s ON s.key = 'math';

INSERT OR IGNORE INTO exam_scores (exam_id, subject_id, score)
SELECT r.id, s.id, r.english_score FROM exam_records r JOIN subjects s ON s.key = 'english';

INSERT OR IGNORE INTO exam_scores (exam_id, subject_id, score)
SELECT r.id, s.id, r.physics_score FROM exam_records r JOIN subjects s ON s.key = 'physics';

INSERT OR IGNORE INTO exam_scores (exam_id, subject_id, score)
SELECT r.id, s.id, r.chemistry_score FROM exam_records r JOIN subjects s ON s.key = 'chemistry';

INSERT OR IGNORE INTO exam_scores (exam_id, subject_id, score)
SELECT r.id, s.id, r.biology_score FROM exam_records r JOIN subjects s ON s.key = 'biology';

-- 旧档案的各科目标回填到科目字典。
-- 升级后成绩页的目标虚线要与升级前一致，所以这一步只做一次：
-- 之后 `subjects.goal` 才是权威，`user_profile.subject_targets` 只剩兼容价值。
UPDATE subjects
SET goal = (
  SELECT CAST(json_extract(p.subject_targets, '$.' || subjects.key) AS REAL)
  FROM user_profile p
  WHERE p.id = 1
    AND json_valid(p.subject_targets)
    AND json_type(p.subject_targets, '$.' || subjects.key) = 'integer'
)
WHERE EXISTS (
  SELECT 1 FROM user_profile p
  WHERE p.id = 1
    AND json_valid(p.subject_targets)
    AND json_type(p.subject_targets, '$.' || subjects.key) = 'integer'
);
