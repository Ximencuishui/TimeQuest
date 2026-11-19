-- Attach an upstream knowledge-graph topic to a mistake.
--
-- `graph_topic_id` is the stable id from cn-math-taxonomy (e.g. `cnm_001`).
-- It is NULL for mistakes recorded without picking a graph point.
-- `graph_subject` is the subject code of the pack the topic came from.
-- `graph_topic_name` is the topic's display name, copied in so the mistake
-- list can name the point without loading the whole subject pack again.
--
-- These columns mirror `task_knowledge_points`, so one knowledge point id means
-- the same thing whether it is reached from a task or from the mistake book.
-- That is what keeps the graph and the mistake book from looking like two
-- separate maps of the same subject.
ALTER TABLE mistakes ADD COLUMN graph_topic_id TEXT;
ALTER TABLE mistakes ADD COLUMN graph_subject TEXT;
ALTER TABLE mistakes ADD COLUMN graph_topic_name TEXT;
