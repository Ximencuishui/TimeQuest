-- Attach an upstream knowledge-graph topic to a task knowledge point.
--
-- `graph_topic_id` is the stable id from cn-math-taxonomy (e.g. `cnm_001`).
-- It is NULL for textbook points and student-authored points.
-- `graph_subject` is the subject code of the pack the topic came from.
--
-- The existing UNIQUE(task_id, section_name, name) constraint is left alone so
-- old rows keep working. A partial unique index additionally stops the same
-- graph topic from being added twice to one task.
ALTER TABLE task_knowledge_points ADD COLUMN graph_topic_id TEXT;
ALTER TABLE task_knowledge_points ADD COLUMN graph_subject TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_knowledge_points_graph_topic
  ON task_knowledge_points(task_id, graph_topic_id)
  WHERE graph_topic_id IS NOT NULL;
