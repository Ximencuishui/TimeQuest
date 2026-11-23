-- 用户主动删过的科目。
--
-- 默认赛道的出厂科目每次启动都会播种一遍。没有这张表的话，
-- 删掉「物理」下次启动它就带着满分目标回来了 —— 而它的历史成绩
-- 在删除时已经被清掉，用户看到的是一科空壳。
CREATE TABLE IF NOT EXISTS removed_subjects (
  key        TEXT PRIMARY KEY,
  removed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
