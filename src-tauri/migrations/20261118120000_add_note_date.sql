-- 便签可绑定一个日期（YYYY-MM-DD，可空）。
-- 绑定后这张便签就会出现在「当天要做的事」里，历史也能按日期追溯。
ALTER TABLE notes ADD COLUMN note_date TEXT;
