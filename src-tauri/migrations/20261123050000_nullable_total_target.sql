-- 总分目标改成可空。
--
-- 4.0 起总分目标属于赛道而不是产品形态：技能习得这类赛道按分科计，
-- 压根没有「总分」这回事。所以档案里的 total_target 必须能空，
-- 而且不能带 DEFAULT 610 —— 那会把高考的分值塞进每一条新赛道。
--
-- 已有数据原样保留：老用户档案里的数字是他们自己填的，不替他做主。
ALTER TABLE user_profile RENAME TO user_profile_legacy;

CREATE TABLE user_profile (
  id               INTEGER PRIMARY KEY CHECK(id = 1),
  avatar           TEXT,
  grade            TEXT NOT NULL DEFAULT '高三',
  region           TEXT NOT NULL DEFAULT '',
  total_target     INTEGER,
  subject_targets  TEXT NOT NULL DEFAULT '{"chinese":120,"math":130,"english":120,"physics":80,"chemistry":80,"biology":80}',
  updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

INSERT INTO user_profile (id, avatar, grade, region, total_target, subject_targets, updated_at)
  SELECT id, avatar, grade, region, total_target, subject_targets, updated_at
  FROM user_profile_legacy;

DROP TABLE user_profile_legacy;
