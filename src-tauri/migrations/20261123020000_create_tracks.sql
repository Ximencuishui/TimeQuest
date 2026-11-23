-- 4.0 赛道与科目字典。
--
-- `tracks` 是学习方向（高考 / 考研 / 语言学习 / 技能习得……），
-- `subjects` 挂在赛道下面。换赛道就是换一套科目 + 一套目标分。
--
-- `user_profile` 里的 `total_target` / `subject_targets` 从这里开始
-- 只是兼容留档，权威来源变成 `goals.target_score` 与 `subjects.goal`。

CREATE TABLE IF NOT EXISTS tracks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'exam'
              CHECK(kind IN ('exam','skill','course')),
  score_mode  TEXT NOT NULL DEFAULT 'total'
              CHECK(score_mode IN ('total','per_subject','band')),
  is_primary  INTEGER NOT NULL DEFAULT 0,
  color       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_tracks_primary ON tracks(is_primary);

-- subjects 补赛道列。ALTER TABLE ADD COLUMN 带 REFERENCES 是允许的
-- （新增列的默认值必须是 NULL），外键在写入时检查。
ALTER TABLE subjects ADD COLUMN track_id INTEGER REFERENCES tracks(id);

CREATE INDEX IF NOT EXISTS idx_subjects_track ON subjects(track_id);

-- 默认赛道。老库先落在「高考」上，P1-3 起由赛道模板 / 赛道包播种。
INSERT INTO tracks (name, kind, score_mode, is_primary)
SELECT '高考', 'exam', 'total', 1
WHERE NOT EXISTS (SELECT 1 FROM tracks);

-- 历史科目与目标都归到默认赛道。
UPDATE subjects
SET track_id = (SELECT id FROM tracks WHERE is_primary = 1)
WHERE track_id IS NULL;

UPDATE goals
SET track_id = (SELECT id FROM tracks WHERE is_primary = 1)
WHERE track_id IS NULL;

-- 总分目标从旧档案搬到主目标。旧档案的值不再权威，只搬一次。
UPDATE goals
SET target_score = (SELECT total_target FROM user_profile WHERE id = 1)
WHERE is_primary = 1 AND target_score IS NULL;

-- 各科目标从旧档案搬到科目字典。旧档案的六键是升级前的权威值，
-- 搬过来之后 `subjects.goal` 才是权威源，旧档案只留档。
--
-- `subject_targets` 存的是 JSON 文本，键跟 `subjects.key` 对得上才覆盖；
-- 档案里没有的科目保持种子目标，不被写成 NULL。
UPDATE subjects
SET goal = CASE
    WHEN json_valid((SELECT subject_targets FROM user_profile WHERE id = 1)) THEN
        COALESCE(
            json_extract(
                (SELECT subject_targets FROM user_profile WHERE id = 1),
                '$.' || subjects.key
            ),
            goal
        )
    ELSE goal
END;
