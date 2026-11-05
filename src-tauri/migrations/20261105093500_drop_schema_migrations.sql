-- rusqlite bootstrap used to track version 1 here.
-- sqlx owns schema in _sqlx_migrations. Drop the leftover table on old and new databases.
DROP TABLE IF EXISTS schema_migrations;
