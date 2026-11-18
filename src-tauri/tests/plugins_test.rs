//! 工具箱插件：仓库清单、下载安装、卸载、选项读写。
//!
//! 插件包随应用内置（`resources/plugins/*.json`），安装动作把它落到
//! `appData/plugins/<id>/plugin.json`，已安装列表记在 settings 里。

use rusqlite::{params, Connection};
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use timequest_lib::{
    builtin_plugin_resources, install_plugin_impl, list_plugins_impl, plugin_options_impl,
    plugin_resource_text, set_plugin_option_impl, uninstall_plugin_impl, PluginInfo,
    INSTALLED_PLUGINS_KEY, PLUGIN_RESOURCES_DIR,
};

async fn open_rusqlite_migrated() -> (PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!(
        "timequest-plugins-{}.db",
        uuid::Uuid::new_v4()
    ));
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    let path_str = path.to_string_lossy().replace('\\', "/");
    let url = format!("sqlite:{path_str}?mode=rwc");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect temp sqlite");
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("pragma");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("migrate");
    pool.close().await;

    let conn = Connection::open(&path).expect("rusqlite open");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("pragma foreign_keys");
    (path, conn)
}

fn scratch_dir(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!("timequest-plugins-{label}-{}", uuid::Uuid::new_v4()))
}

fn installed_ids(conn: &Connection) -> Vec<String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![INSTALLED_PLUGINS_KEY],
            |row| row.get(0),
        )
        .unwrap_or(None);
    match raw {
        Some(value) => serde_json::from_str(&value).expect("installed ids json"),
        None => Vec::new(),
    }
}

/// 内置仓库里第一个带资源文件的插件（教材库插件声明了教材清单）。
fn plugin_with_resources(conn: &Connection) -> PluginInfo {
    list_plugins_impl(conn)
        .expect("list plugins")
        .into_iter()
        .find(|plugin| !plugin.resources.is_empty())
        .expect("内置仓库里至少有一个带资源的插件")
}

#[tokio::test]
async fn catalog_lists_builtin_plugins_not_installed_yet() {
    let (path, conn) = open_rusqlite_migrated().await;

    let plugins = list_plugins_impl(&conn).expect("list plugins");
    assert!(!plugins.is_empty(), "内置仓库里至少有插件");

    for plugin in &plugins {
        assert!(!plugin.id.is_empty());
        assert!(!plugin.name.is_empty(), "插件必须有名字");
        assert!(plugin.size_kb >= 1);
        assert!(!plugin.installed, "刚装好的应用不该有已安装插件");
    }

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn install_plugin_writes_package_and_marks_installed() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("install");

    let plugins = list_plugins_impl(&conn).expect("list plugins");
    let target = plugins.first().expect("at least one plugin").id.clone();

    let installed = install_plugin_impl(&conn, &dir, &target).expect("install");
    assert!(installed.installed);
    assert_eq!(installed.id, target);

    let package = dir.join(&target).join("plugin.json");
    assert!(package.is_file(), "插件包要落到本地目录");
    let raw = std::fs::read_to_string(&package).expect("read package");
    assert!(raw.contains(&target), "落地的就是仓库里那个包");

    assert_eq!(installed_ids(&conn), vec![target.clone()]);

    let after = list_plugins_impl(&conn).expect("list after install");
    let marked = after
        .iter()
        .find(|plugin| plugin.id == target)
        .expect("installed plugin in list");
    assert!(marked.installed);
    assert!(
        after.iter().filter(|plugin| plugin.installed).count() == 1,
        "只装了一个插件"
    );

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn install_plugin_twice_keeps_one_record() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("install-twice");

    let plugins = list_plugins_impl(&conn).expect("list plugins");
    let target = plugins.first().expect("at least one plugin").id.clone();

    install_plugin_impl(&conn, &dir, &target).expect("first install");
    install_plugin_impl(&conn, &dir, &target).expect("second install");

    assert_eq!(
        installed_ids(&conn),
        vec![target.clone()],
        "重复下载不能把同一个插件记成两个"
    );

    let rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM app_settings WHERE key = ?1",
            params![INSTALLED_PLUGINS_KEY],
            |row| row.get(0),
        )
        .expect("count rows");
    assert_eq!(rows, 1, "已安装列表只占一行");

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn install_unknown_plugin_fails_without_touching_state() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("unknown");

    let error = install_plugin_impl(&conn, &dir, "no-such-plugin").expect_err("must fail");
    assert!(error.contains("no-such-plugin"));
    assert!(installed_ids(&conn).is_empty());
    assert!(!dir.join("no-such-plugin").exists());

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn uninstall_plugin_removes_files_and_record() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("uninstall");

    let plugins = list_plugins_impl(&conn).expect("list plugins");
    let target = plugins.first().expect("at least one plugin").id.clone();
    install_plugin_impl(&conn, &dir, &target).expect("install");

    uninstall_plugin_impl(&conn, &dir, &target).expect("uninstall");

    assert!(installed_ids(&conn).is_empty());
    assert!(
        !dir.join(&target).exists(),
        "卸载后本地目录要删掉"
    );
    let after = list_plugins_impl(&conn).expect("list after uninstall");
    let marked = after
        .iter()
        .find(|plugin| plugin.id == target)
        .expect("plugin still in catalog");
    assert!(!marked.installed);

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn uninstall_plugin_that_is_not_installed_is_ok() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("uninstall-missing");

    uninstall_plugin_impl(&conn, &dir, "no-such-plugin").expect("idempotent uninstall");
    assert!(installed_ids(&conn).is_empty());

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn plugin_options_fall_back_to_defaults_and_can_be_overridden() {
    let (path, conn) = open_rusqlite_migrated().await;

    let plugins = list_plugins_impl(&conn).expect("list plugins");
    let plugin = plugins
        .iter()
        .find(|plugin| !plugin.options.is_empty())
        .expect("at least one plugin with options");
    let option = plugin.options.first().expect("option");

    let values = plugin_options_impl(&conn, &plugin.id).expect("options");
    assert_eq!(values.len(), plugin.options.len());
    assert_eq!(values[0].value, option.default, "没设置过时用包里的默认值");

    set_plugin_option_impl(&conn, &plugin.id, &option.key, "42").expect("set option");
    let after = plugin_options_impl(&conn, &plugin.id).expect("options after set");
    assert_eq!(after[0].value, "42");

    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![format!("plugin.{}.{}", plugin.id, option.key)],
            |row| row.get(0),
        )
        .unwrap_or(None);
    assert_eq!(stored.as_deref(), Some("42"));

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn set_unknown_option_is_rejected() {
    let (path, conn) = open_rusqlite_migrated().await;

    let plugins = list_plugins_impl(&conn).expect("list plugins");
    let plugin = plugins.first().expect("at least one plugin");

    let error =
        set_plugin_option_impl(&conn, &plugin.id, "not_declared", "1").expect_err("must fail");
    assert!(error.contains("not_declared"));

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn broken_installed_list_does_not_break_the_toolbox() {
    let (path, conn) = open_rusqlite_migrated().await;

    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES (?1, '{not json', datetime('now'))",
        params![INSTALLED_PLUGINS_KEY],
    )
    .expect("poison settings");

    let plugins = list_plugins_impl(&conn).expect("list plugins");
    assert!(!plugins.is_empty());
    assert!(plugins.iter().all(|plugin| !plugin.installed));

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn installed_state_survives_a_new_connection() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("persist");

    let plugins = list_plugins_impl(&conn).expect("list plugins");
    let target = plugins.first().expect("at least one plugin").id.clone();
    install_plugin_impl(&conn, &dir, &target).expect("install");
    drop(conn);

    let conn = Connection::open(&path).expect("reopen");
    let after = list_plugins_impl(&conn).expect("list after reopen");
    assert!(
        after
            .iter()
            .find(|plugin| plugin.id == target)
            .expect("plugin in list")
            .installed,
        "已安装状态记在库里，重开应用还在"
    );

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn plugin_catalog_lists_declared_resources() {
    let (path, conn) = open_rusqlite_migrated().await;

    let plugin = plugin_with_resources(&conn);
    assert!(
        !plugin.resources.is_empty(),
        "带资源的插件要列出资源文件"
    );
    for resource in &plugin.resources {
        assert!(!resource.path.is_empty());
        assert!(
            !resource.path.split('/').any(|segment| segment == ".."),
            "资源路径不能回退目录：{}",
            resource.path
        );
    }

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn install_plugin_unpacks_resources_to_disk() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("resources");
    let plugin = plugin_with_resources(&conn);

    install_plugin_impl(&conn, &dir, &plugin.id).expect("install");

    for resource in &plugin.resources {
        let file = dir
            .join(&plugin.id)
            .join(PLUGIN_RESOURCES_DIR)
            .join(&resource.path);
        assert!(file.is_file(), "资源要落到插件目录：{}", resource.path);
        let local = std::fs::read_to_string(&file).expect("read resource");
        let (_, builtin) = builtin_plugin_resources(&plugin.id)
            .into_iter()
            .find(|(resource_path, _)| *resource_path == resource.path)
            .expect("builtin resource");
        assert_eq!(local, builtin, "落地的内容要和内置的那份一致");
    }

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn plugin_resource_is_readable_before_install() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("not-installed");
    let plugin = plugin_with_resources(&conn);
    let resource = plugin.resources.first().expect("resource");

    let text = plugin_resource_text(&dir, &plugin.id, &resource.path).expect("read builtin");
    assert!(!text.is_empty(), "插件没装也能读内置资源");

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn plugin_resource_path_traversal_is_rejected() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("traversal");
    let plugin = plugin_with_resources(&conn);

    for bad in ["../secret", "..\\secret", "/etc/passwd", "", "sub/../../escape"] {
        let error = plugin_resource_text(&dir, &plugin.id, bad).expect_err("must fail");
        assert!(!error.is_empty(), "路径 {bad:?} 要有明确报错");
    }

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn missing_plugin_resource_reports_the_path() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("missing-resource");
    let plugin = plugin_with_resources(&conn);

    let error =
        plugin_resource_text(&dir, &plugin.id, "not-there.json").expect_err("must fail");
    assert!(error.contains("not-there.json"), "报错要点名资源：{error}");

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn textbook_plugin_options_carry_user_facing_text() {
    let (path, conn) = open_rusqlite_migrated().await;

    let plugins = list_plugins_impl(&conn).expect("list plugins");
    let plugin = plugins
        .iter()
        .find(|plugin| plugin.id == "china-textbook")
        .expect("教材库插件");

    assert!(
        plugin.options.iter().all(|option| option.advanced),
        "教材库的技术选项都该收进高级设置，别摆在一进页面就看见"
    );
    assert!(
        plugin.options.iter().all(|option| !option.help.trim().is_empty()),
        "每个选项都要有一句给普通用户看的说明"
    );

    let source = plugin
        .options
        .iter()
        .find(|option| option.key == "download_source")
        .expect("download_source");
    assert_eq!(source.choices, vec!["blob", "raw"]);
    assert_eq!(
        source.choice_labels.get("blob").map(String::as_str),
        Some("标准通道（推荐）"),
        "下拉里显示中文名，不是 blob"
    );
    assert_eq!(
        source.choice_labels.get("raw").map(String::as_str),
        Some("备用通道（标准通道失败时再试）")
    );

    let token = plugin
        .options
        .iter()
        .find(|option| option.key == "github_token")
        .expect("github_token");
    assert!(token.secret, "令牌不该明文显示在屏幕上");
    assert!(token.label.contains("选填"), "令牌对普通用户是选填的");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn plugin_option_defaults_are_backward_compatible() {
    let (path, conn) = open_rusqlite_migrated().await;

    let plugins = list_plugins_impl(&conn).expect("list plugins");
    let plugin = plugins
        .iter()
        .find(|plugin| plugin.id == "focus-25")
        .expect("focus-25");

    for option in &plugin.options {
        assert!(option.help.is_empty(), "没写 help 就是空");
        assert!(option.choice_labels.is_empty(), "没写 choice_labels 就是空");
        assert!(!option.advanced, "没标 advanced 就是普通选项");
        assert!(!option.secret, "没标 secret 就不是敏感项");
    }

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn reinstall_plugin_removes_stale_resource_files() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("stale");
    let plugin = plugin_with_resources(&conn);

    install_plugin_impl(&conn, &dir, &plugin.id).expect("install");
    let stale = dir
        .join(&plugin.id)
        .join(PLUGIN_RESOURCES_DIR)
        .join("stale.json");
    std::fs::write(&stale, "{}").expect("write stale");

    install_plugin_impl(&conn, &dir, &plugin.id).expect("reinstall");
    assert!(!stale.exists(), "重装要清掉清单外的残留文件");

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}