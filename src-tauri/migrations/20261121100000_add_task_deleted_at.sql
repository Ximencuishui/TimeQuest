-- 删除 = 移入回收站：只打标记，不动历史数据。
--
-- deleted_at 为 NULL 表示任务还在计划里；非 NULL 表示已被移到回收站，
-- 随时可以清空这个字段找回来。排期与学习记录一律保留，
-- 由查询侧（list_tasks / 会话 JOIN）过滤掉回收站里的任务。
ALTER TABLE tasks ADD COLUMN deleted_at TEXT;