-- 历史数据的赛道归属补齐。
--
-- 4.0 拆表时 `exam_sessions` 是从 `exam_records` 展开的，`track_id` 留了 NULL。
-- 成绩页按赛道筛选时这些历史场次一个都不显示，等于把旧成绩弄丢了。
--
-- `subjects` / `goals` 在 create_tracks 迁移里回填过，这里再兜底一次：
-- 导入流程会把归属清空再重建，中间漏一步老用户升级后六科就全成了孤儿。
UPDATE exam_sessions
SET track_id = (SELECT id FROM tracks WHERE is_primary = 1)
WHERE track_id IS NULL;

UPDATE subjects
SET track_id = (SELECT id FROM tracks WHERE is_primary = 1)
WHERE track_id IS NULL;

UPDATE goals
SET track_id = (SELECT id FROM tracks WHERE is_primary = 1)
WHERE track_id IS NULL;
