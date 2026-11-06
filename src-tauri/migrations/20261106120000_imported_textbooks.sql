-- User-imported textbook outlines. Built-in books stay in the binary.
-- Same (subject, version, volume) replaces the previous import.
CREATE TABLE IF NOT EXISTS imported_textbooks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject      TEXT NOT NULL,
  version      TEXT NOT NULL,
  volume       TEXT NOT NULL,
  outline_json TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (subject, version, volume)
);
