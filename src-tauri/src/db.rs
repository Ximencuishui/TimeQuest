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

/// How many startup copies to leave in `appData/backups`.
pub const BACKUP_KEEP: usize = 7;

/// Copy an existing `timequest.db` to `backups/timequest_YYYYMMDD_HHMMSS.db`.
/// Missing database is a no-op. After the copy, only the newest [`BACKUP_KEEP`] files remain.
pub fn backup_db_file(db_path: &Path, now: chrono::DateTime<chrono::Local>) -> Result<(), String> {
    if !db_path.is_file() {
        return Ok(());
    }
    let parent = db_path
        .parent()
        .ok_or_else(|| "数据库路径没有父目录".to_string())?;
    let backups = parent.join("backups");
    std::fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
    let dest = backups.join(backup_file_name(now));
    std::fs::copy(db_path, &dest).map_err(|e| e.to_string())?;
    prune_backups(&backups, BACKUP_KEEP)
}

pub fn backup_file_name(now: chrono::DateTime<chrono::Local>) -> String {
    format!("timequest_{}.db", now.format("%Y%m%d_%H%M%S"))
}

fn is_startup_backup(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let Some(stamp) = name
        .strip_prefix("timequest_")
        .and_then(|rest| rest.strip_suffix(".db"))
    else {
        return false;
    };
    let bytes = stamp.as_bytes();
    bytes.len() == 15
        && bytes[..8].iter().all(|c| c.is_ascii_digit())
        && bytes[8] == b'_'
        && bytes[9..].iter().all(|c| c.is_ascii_digit())
}

fn prune_backups(dir: &Path, keep: usize) -> Result<(), String> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.is_file() && is_startup_backup(path))
        .collect();
    files.sort();
    if files.len() <= keep {
        return Ok(());
    }
    let extra = files.len() - keep;
    for path in files.into_iter().take(extra) {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
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

    fn local_stamp(
        y: i32,
        m: u32,
        d: u32,
        hh: u32,
        mm: u32,
        ss: u32,
    ) -> chrono::DateTime<chrono::Local> {
        chrono::TimeZone::with_ymd_and_hms(&chrono::Local, y, m, d, hh, mm, ss).unwrap()
    }

    #[test]
    fn startup_backup_copies_existing_db_and_keeps_seven() {
        let root = std::env::temp_dir().join(format!("timequest-backup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db = root.join("timequest.db");
        std::fs::write(&db, b"snapshot").unwrap();
        let backups = root.join("backups");
        for n in 1..=7 {
            std::fs::create_dir_all(&backups).unwrap();
            std::fs::write(
                backups.join(format!("timequest_2026110{n}_000000.db")),
                format!("old-{n}"),
            )
            .unwrap();
        }
        std::fs::write(backups.join("notes.txt"), b"leave-me").unwrap();

        let now = local_stamp(2026, 11, 6, 12, 59, 8);
        backup_db_file(&db, now).unwrap();

        let newest = backups.join(backup_file_name(now));
        assert_eq!(std::fs::read(&newest).unwrap(), b"snapshot");
        assert_eq!(
            std::fs::read(backups.join("notes.txt")).unwrap(),
            b"leave-me"
        );
        assert!(!backups.join("timequest_20261101_000000.db").exists());

        let kept: Vec<_> = std::fs::read_dir(&backups)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("timequest_") && name.ends_with(".db"))
            .collect();
        assert_eq!(kept.len(), BACKUP_KEEP);
        assert!(kept
            .iter()
            .any(|name| name == "timequest_20261106_125908.db"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn startup_backup_skips_when_db_is_missing() {
        let root =
            std::env::temp_dir().join(format!("timequest-backup-miss-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db = root.join("timequest.db");
        backup_db_file(&db, local_stamp(2026, 11, 6, 8, 0, 0)).unwrap();
        assert!(!root.join("backups").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
