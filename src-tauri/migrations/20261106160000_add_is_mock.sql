-- Demo rows are ordinary tasks / sessions / exams with this flag set.
-- Real inserts leave the default 0, so clear_mock_data can delete only the demo.
ALTER TABLE tasks ADD COLUMN is_mock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_sessions ADD COLUMN is_mock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exam_records ADD COLUMN is_mock INTEGER NOT NULL DEFAULT 0;
