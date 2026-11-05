use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

/// In-memory DB with migrations applied and seed row in `user_stats` / achievements.
pub async fn setup() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("connect sqlite memory");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("pragma foreign_keys");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("run migrations");
    pool
}
