//! 工具箱插件：仓库清单、下载安装、卸载、选项读写。
//!
//! 插件包随应用内置（`resources/plugins/*.json`），安装动作把它落到
//! `appData/plugins/<id>/plugin.json`，已安装列表记在 settings 里。

use rusqlite::{params, Connection};
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use timequest_lib::{
    builtin_plugin_resources, get_list_setting_impl, install_plugin_impl, list_plugins_impl,
    plugin_options_impl, plugin_resource_text, reason_whitelist, seed_track_provides,
    set_plugin_option_impl, uninstall_plugin_impl, GoalSeed, PluginInfo, SubjectSeed,
    TrackProvides, TrackSeed, INSTALLED_PLUGINS_KEY, PLUGIN_RESOURCES_DIR,
    PLUGIN_RESOURCE_KIND_MOTIVATION_PACK, TRACK_METHODS_SETTING_KEY,
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

/// 表里某一列的行数。
fn count_rows(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap_or(0)
}

/// 内置仓库里的高考赛道包。
fn gaokao_track_package(conn: &Connection) -> PluginInfo {
    list_plugins_impl(conn)
        .expect("list plugins")
        .into_iter()
        .find(|plugin| plugin.id == "track-gaokao")
        .expect("内置仓库里应该有高考赛道包")
}

/// 赛道包与普通插件在清单里能区分开。
#[tokio::test]
async fn catalog_distinguishes_track_packages_from_regular_plugins() {
    let (path, conn) = open_rusqlite_migrated().await;

    let plugins = list_plugins_impl(&conn).expect("list plugins");
    let track_package = plugins
        .iter()
        .find(|plugin| plugin.id == "track-gaokao")
        .expect("内置仓库里要有高考赛道包");
    assert_eq!(track_package.kind, "track");
    let provides = track_package.provides.as_ref().expect("provides");
    assert_eq!(
        provides.track.as_ref().map(|track| track.name.as_str()),
        Some("高考")
    );
    assert_eq!(provides.subjects.len(), 6);
    assert_eq!(provides.goals.len(), 1);
    // 目标日期由包里的日期规则算出来，不硬编码。
    assert!(provides
        .goals
        .first()
        .and_then(|goal| goal.date_rule.as_ref())
        .is_some());

    for plugin in &plugins {
        if plugin.id == "track-gaokao" {
            continue;
        }
        assert_eq!(plugin.kind, "plugin", "其它插件还是普通插件");
    }

    let _ = std::fs::remove_file(&path);
}

/// 一条自定义赛道包提供的内容：考研。
fn kaoyan_provides() -> TrackProvides {
    TrackProvides {
        track: Some(TrackSeed {
            name: "考研".to_string(),
            kind: Some("exam".to_string()),
            score_mode: Some("total".to_string()),
            is_primary: Some(true),
            color: None,
        }),
        subjects: vec![
            SubjectSeed {
                key: "kaoyan_politics".to_string(),
                label: "政治".to_string(),
                full_mark: Some(100.0),
                goal: Some(70.0),
                unit: Some("分".to_string()),
                order_index: Some(0),
            },
            SubjectSeed {
                key: "kaoyan_english".to_string(),
                label: "英语".to_string(),
                full_mark: Some(100.0),
                goal: Some(70.0),
                unit: Some("分".to_string()),
                order_index: Some(1),
            },
        ],
        goals: vec![GoalSeed {
            name: "考研".to_string(),
            date: Some("2026-12-20".to_string()),
            kind: Some("exam".to_string()),
            is_primary: Some(true),
            target_score: Some(350.0),
            date_rule: None,
        }],
        motivation_pack: None,
        mistake_reasons: None,
        methods: None,
    }
}

/// 赛道包装上之后，赛道、科目、目标各增对应行。
#[tokio::test]
async fn track_package_seeds_track_subjects_and_goals() {
    let (path, conn) = open_rusqlite_migrated().await;

    let tracks_before = count_rows(&conn, "tracks");
    let subjects_before = count_rows(&conn, "subjects");
    let goals_before = count_rows(&conn, "goals");

    seed_track_provides(&conn, &kaoyan_provides()).expect("seed track provides");

    assert_eq!(count_rows(&conn, "tracks"), tracks_before + 1, "多一条赛道");
    assert_eq!(count_rows(&conn, "subjects"), subjects_before + 2, "多两科");
    assert_eq!(count_rows(&conn, "goals"), goals_before + 1, "多一个目标");

    let track_id: i64 = conn
        .query_row("SELECT id FROM tracks WHERE name = '考研'", [], |row| {
            row.get(0)
        })
        .expect("考研赛道");
    let (kind, score_mode, is_primary): (String, String, i64) = conn
        .query_row(
            "SELECT kind, score_mode, is_primary FROM tracks WHERE id = ?1",
            params![track_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("赛道内容");
    assert_eq!(kind, "exam");
    assert_eq!(score_mode, "total");
    assert_eq!(is_primary, 1, "包里说自己是主赛道");

    let (full_mark, goal, unit, subject_track): (f64, f64, String, i64) = conn
        .query_row(
            "SELECT full_mark, goal, unit, track_id FROM subjects WHERE key = 'kaoyan_politics'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("科目内容");
    assert_eq!(full_mark, 100.0);
    assert_eq!(goal, 70.0);
    assert_eq!(unit, "分");
    assert_eq!(subject_track, track_id, "科目归到新赛道下面");

    let (date, goal_primary, target_score): (String, i64, f64) = conn
        .query_row(
            "SELECT date, is_primary, target_score FROM goals WHERE name = '考研'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("目标内容");
    assert_eq!(date, "2026-12-20");
    assert_eq!(goal_primary, 1);
    assert_eq!(target_score, 350.0);

    let _ = std::fs::remove_file(&path);
}

/// 内置的高考赛道包：装上就多出高考目标与六科。
#[tokio::test]
async fn install_track_package_seeds_the_builtin_gaokao_track() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("track-install");

    let package = gaokao_track_package(&conn);
    assert_eq!(package.kind, "track", "高考包是赛道包");
    assert!(package.provides.is_some(), "赛道包带着 provides");
    assert!(
        package
            .resources
            .iter()
            .any(|resource| resource.kind == PLUGIN_RESOURCE_KIND_MOTIVATION_PACK),
        "高考包声明了动机语料包"
    );

    let goals_before = count_rows(&conn, "goals");
    let installed = install_plugin_impl(&conn, &dir, "track-gaokao").expect("install");
    assert!(installed.installed);

    assert_eq!(
        count_rows(&conn, "goals"),
        goals_before + 1,
        "装包时把目标也种进去"
    );
    let (date, is_primary): (String, i64) = conn
        .query_row(
            "SELECT date, is_primary FROM goals WHERE name = '高考'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("高考目标");
    assert!(date.ends_with("-06-07"), "目标日期按 6 月 7 日算：{date}");
    assert_eq!(is_primary, 1);

    let subjects: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM subjects
             WHERE key IN ('chinese','math','english','physics','chemistry','biology')",
            [],
            |row| row.get(0),
        )
        .expect("六科");
    assert_eq!(subjects, 6, "高考六科都在");

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

/// 重复装同一个赛道包不会多出重复行。
#[tokio::test]
async fn install_track_package_twice_does_not_duplicate_rows() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("track-install-twice");

    install_plugin_impl(&conn, &dir, "track-gaokao").expect("first install");
    let tracks = count_rows(&conn, "tracks");
    let subjects = count_rows(&conn, "subjects");
    let goals = count_rows(&conn, "goals");

    install_plugin_impl(&conn, &dir, "track-gaokao").expect("second install");

    assert_eq!(count_rows(&conn, "tracks"), tracks, "赛道不翻倍");
    assert_eq!(count_rows(&conn, "subjects"), subjects, "科目不翻倍");
    assert_eq!(count_rows(&conn, "goals"), goals, "目标不翻倍");

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

/// 装包不会覆盖用户自己改过的科目目标。
#[tokio::test]
async fn track_package_keeps_the_users_own_subject_goals() {
    let (path, conn) = open_rusqlite_migrated().await;

    conn.execute("UPDATE subjects SET goal = 66 WHERE key = 'chinese'", [])
        .expect("改语文目标");

    seed_track_provides(&conn, &kaoyan_provides()).expect("seed track provides");

    let goal: f64 = conn
        .query_row("SELECT goal FROM subjects WHERE key = 'chinese'", [], |row| {
            row.get(0)
        })
        .expect("语文");
    assert_eq!(goal, 66.0, "用户改过的目标不能被装包覆盖");

    let _ = std::fs::remove_file(&path);
}

/// 卸载赛道包不删已有的历史记录。
#[tokio::test]
async fn uninstall_track_package_keeps_the_seeded_rows() {
    let (path, conn) = open_rusqlite_migrated().await;
    let dir = scratch_dir("track-uninstall");

    install_plugin_impl(&conn, &dir, "track-gaokao").expect("install");
    let tracks = count_rows(&conn, "tracks");
    let subjects = count_rows(&conn, "subjects");
    let goals = count_rows(&conn, "goals");

    uninstall_plugin_impl(&conn, &dir, "track-gaokao").expect("uninstall");

    assert_eq!(count_rows(&conn, "tracks"), tracks, "卸载不删赛道");
    assert_eq!(count_rows(&conn, "subjects"), subjects, "卸载不删科目");
    assert_eq!(count_rows(&conn, "goals"), goals, "卸载不删目标");
    assert!(installed_ids(&conn).is_empty());

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

/// 包里不认识的赛道类型退回默认值，不把非法值写进库。
#[tokio::test]
async fn track_package_falls_back_to_the_default_kind() {
    let (path, conn) = open_rusqlite_migrated().await;

    let mut provides = kaoyan_provides();
    if let Some(track) = provides.track.as_mut() {
        track.kind = Some("not-a-kind".to_string());
        track.score_mode = Some("not-a-mode".to_string());
    }

    seed_track_provides(&conn, &provides).expect("seed track provides");

    let (kind, score_mode): (String, String) = conn
        .query_row(
            "SELECT kind, score_mode FROM tracks WHERE name = '考研'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("赛道");
    assert_eq!(kind, "exam");
    assert_eq!(score_mode, "total");

    let _ = std::fs::remove_file(&path);
}

/// 赛道包带的语料配置（错因表 / 学习方式）装上就写进 app_settings，
/// 前后端读的是同一份。
#[tokio::test]
async fn seeding_a_track_package_writes_the_content_settings() {
    let (path, conn) = open_rusqlite_migrated().await;

    let provides = TrackProvides {
        track: Some(TrackSeed {
            name: "考研".to_string(),
            kind: Some("exam".to_string()),
            score_mode: Some("total".to_string()),
            is_primary: Some(false),
            color: None,
        }),
        mistake_reasons: Some(vec![
            "概念不清".to_string(),
            "背不下来".to_string(),
            "其他".to_string(),
        ]),
        methods: Some(vec!["听课".to_string(), "刷题".to_string()]),
        ..Default::default()
    };

    seed_track_provides(&conn, &provides).expect("seed");

    assert_eq!(
        reason_whitelist(&conn),
        vec![
            "概念不清".to_string(),
            "背不下来".to_string(),
            "其他".to_string()
        ]
    );
    assert_eq!(
        get_list_setting_impl(&conn, TRACK_METHODS_SETTING_KEY),
        vec!["听课".to_string(), "刷题".to_string()]
    );

    let _ = std::fs::remove_file(&path);
}

/// 赛道包没带语料配置时，不动已有的配置：内置那份继续生效。
#[tokio::test]
async fn seeding_a_track_package_without_content_keeps_the_builtin_lists() {
    let (path, conn) = open_rusqlite_migrated().await;

    seed_track_provides(&conn, &kaoyan_provides()).expect("seed");

    assert!(
        get_list_setting_impl(&conn, TRACK_METHODS_SETTING_KEY).is_empty(),
        "没带学习方式就不该写这个 key"
    );
    assert!(
        reason_whitelist(&conn).contains(&"概念不清".to_string()),
        "没带错因表就用内置那份"
    );

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