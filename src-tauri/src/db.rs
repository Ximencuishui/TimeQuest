use rusqlite::Connection;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct DbState(pub Mutex<Connection>);

pub struct AppPrefs {
    pub close_to_tray: AtomicBool,
}

impl AppPrefs {
    pub fn new() -> Self {
        Self {
            close_to_tray: AtomicBool::new(true),
        }
    }

    pub fn set_close_to_tray(&self, v: bool) {
        self.close_to_tray.store(v, Ordering::Relaxed);
    }

    pub fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::Relaxed)
    }
}

pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("timequest.db"))
}

pub fn open_db(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(|e| e.to_string())?;
    // Schema is owned by sqlx migrations. This bootstrap only fills gaps on older files.
    // It must not recreate schema_migrations; sqlx drops that legacy table.
    migrate(&conn)?;
    Ok(conn)
}

/// Open a sqlx pool against the same SQLite file and run `migrations/`.
pub async fn open_sqlx_pool(path: &Path) -> Result<SqlitePool, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // sqlx SQLite URL prefers forward slashes even on Windows
    let path_str = path.to_string_lossy().replace('\\', "/");
    let url = format!("sqlite:{path_str}?mode=rwc");
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(pool)
}

pub fn with_db<T>(
    state: &State<DbState>,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    f(&conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS tasks (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          title         TEXT NOT NULL,
          type          TEXT NOT NULL CHECK(type IN ('main','side')),
          subject       TEXT,
          textbook      TEXT,
          unit_name     TEXT DEFAULT '课',
          total_units   INTEGER,
          total_rounds  INTEGER DEFAULT 1,
          current_round INTEGER DEFAULT 1,
          color         TEXT,
          archived      INTEGER DEFAULT 0,
          created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS task_sessions (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id         INTEGER NOT NULL REFERENCES tasks(id),
          date            TEXT NOT NULL,
          start_time      TEXT NOT NULL,
          end_time        TEXT NOT NULL,
          round           INTEGER DEFAULT 1,
          status          TEXT NOT NULL DEFAULT 'planned'
                          CHECK(status IN ('planned','done','missed','rescheduled')),
          planned_units   INTEGER DEFAULT 0,
          actual_units    INTEGER DEFAULT 0,
          self_rating     INTEGER,
          self_note       TEXT,
          rescheduled_to  INTEGER REFERENCES task_sessions(id),
          xp_awarded      INTEGER DEFAULT 0,
          created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS actual_logs (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          date         TEXT NOT NULL,
          start_at     TEXT,
          end_at       TEXT,
          duration_min INTEGER NOT NULL,
          subject      TEXT,
          method       TEXT,
          tag_type     TEXT NOT NULL DEFAULT 'study'
                       CHECK(tag_type IN ('study','sport','game','other')),
          session_id   INTEGER REFERENCES task_sessions(id),
          note         TEXT,
          created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS notes (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          content    TEXT NOT NULL,
          color      TEXT NOT NULL DEFAULT 'yellow',
          pinned     INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS user_stats (
          id               INTEGER PRIMARY KEY CHECK(id = 1),
          total_xp         INTEGER DEFAULT 0,
          current_level    INTEGER DEFAULT 1,
          current_streak   INTEGER DEFAULT 0,
          longest_streak   INTEGER DEFAULT 0,
          last_done_date   TEXT
        );

        CREATE TABLE IF NOT EXISTS achievements (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          description TEXT
        );

        CREATE TABLE IF NOT EXISTS user_achievements (
          achievement_id TEXT PRIMARY KEY REFERENCES achievements(id),
          unlocked_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_date ON task_sessions(date);
        CREATE INDEX IF NOT EXISTS idx_sessions_task ON task_sessions(task_id);
        CREATE INDEX IF NOT EXISTS idx_logs_date ON actual_logs(date);
        CREATE INDEX IF NOT EXISTS idx_logs_session ON actual_logs(session_id);
        "#,
    )
    .map_err(|e| e.to_string())?;

    conn.execute_batch(
        r#"
        INSERT OR IGNORE INTO user_stats (id) VALUES (1);
        INSERT OR IGNORE INTO achievements (id, name, description) VALUES
          ('first_round', '首轮完成', '某主线任务当前轮进度达标'),
          ('comeback', '逆风翻盘', '改期后完成且自评≥4星'),
          ('balanced', '均衡发展', '一周内主线与副本均有完成'),
          ('streak_5', '持续在场', '连续5天有完成记录');
        "#,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn scratch_db(label: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("timequest-{label}-{}.db", uuid::Uuid::new_v4()));
        remove_sqlite(&path);
        path
    }

    fn remove_sqlite(path: &Path) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [name],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    #[tokio::test]
    async fn open_db_does_not_recreate_legacy_schema_migrations() {
        let path = scratch_db("legacy-schema-migrations");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
                 INSERT INTO schema_migrations (version) VALUES (1);",
            )
            .unwrap();
        }

        let pool = open_sqlx_pool(&path).await.expect("sqlx migrate");
        pool.close().await;
        let conn = open_db(&path).expect("open_db");

        assert!(
            !table_exists(&conn, "schema_migrations"),
            "schema_migrations must stay dropped after the rusqlite bootstrap"
        );
        let stats: i64 = conn
            .query_row("SELECT COUNT(*) FROM user_stats WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stats, 1);
        let achievements: i64 = conn
            .query_row("SELECT COUNT(*) FROM achievements", [], |row| row.get(0))
            .unwrap();
        assert_eq!(achievements, 4);

        drop(conn);
        remove_sqlite(&path);
    }
}
