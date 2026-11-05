//! 成就检查只走 `complete_session_impl` 的内联逻辑。
//!
//! `check_achievements_after_complete` 已从 `src/gamification.rs` 删除，不得接回生产路径。
//! 该函数与内联判定不一致（`total_units <= 0` 仍可能解锁 first_round；
//! balanced 锚在墙钟 `date('now','localtime')` 且不要求 `actual_units > 0`）。
//!
//! 护栏不扫描源码文本，而是：
//!
//! ```text
//! cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D dead_code
//! ```
//!
//! 重新引入这个函数且没有调用点时，clippy 会因 `dead_code` 失败。
//! 不要再给它加上 `#[allow(dead_code)]`。

/// 编译期占位：真正的护栏是上面的 clippy `-D dead_code`，不是字符串匹配。
#[test]
fn achievement_check_is_not_the_removed_helper() {
    let _guard = "cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D dead_code";
}
