-- Knowledge points recorded on a task. One row per point, not a new task.
-- `section_name` is the textbook section. `is_mastered` is 1 after that
-- section is imported as already known, checked in the drawer, or completed
-- with actual_units > 0.
CREATE TABLE IF NOT EXISTS task_knowledge_points (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  section_name TEXT NOT NULL,
  name         TEXT NOT NULL,
  is_mastered  INTEGER NOT NULL DEFAULT 0 CHECK (is_mastered IN (0, 1)),
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (task_id, section_name, name)
);

CREATE INDEX IF NOT EXISTS idx_task_knowledge_points_task
  ON task_knowledge_points(task_id);
