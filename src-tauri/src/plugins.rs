//! 工具箱插件：内置插件仓库 + 本地安装。
//!
//! 插件包放在 `resources/plugins/*.json`，由 `build.rs` 嵌入二进制，
//! 所以打包后的应用和测试读到的是同一份仓库清单，不依赖运行目录。
//! 一个文件就是一个插件：文件名是插件 id，文件内容是插件清单。
//!
//! 安装 = 把插件包落到 `appData/plugins/<id>/plugin.json`，并登记到 settings；
//! 卸载 = 删掉这个目录并从登记里移除。已安装列表存在 settings 里，
//! 不新增数据表，导出 / 导入不受影响。

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

include!(concat!(env!("OUT_DIR"), "/builtin_plugins.rs"));

/// settings 里记录已安装插件 id 的 key。
pub const INSTALLED_PLUGINS_KEY: &str = "toolbox.installed_plugins";

/// 插件选项在 settings 里的前缀：`plugin.<插件 id>.<选项 key>`。
pub const PLUGIN_OPTION_PREFIX: &str = "plugin.";

/// 插件包目录名（安装后落地的文件名）。
pub const PLUGIN_PACKAGE_FILE: &str = "plugin.json";

/// 插件资源在插件目录下的子目录名。
pub const PLUGIN_RESOURCES_DIR: &str = "resources";

/// 资源类型：普通文件。
pub const PLUGIN_RESOURCE_KIND_FILE: &str = "file";

/// 资源类型：教材清单（JSON，描述可下载的教材）。
pub const PLUGIN_RESOURCE_KIND_TEXTBOOK_CATALOG: &str = "textbook_catalog";

/// 资源类型：知识图谱（JSON，知识点节点 / 先修边 / 学科包清单）。
pub const PLUGIN_RESOURCE_KIND_KNOWLEDGE_GRAPH: &str = "knowledge_graph";

fn default_option_kind() -> String {
    "text".to_string()
}

fn default_resource_kind() -> String {
    PLUGIN_RESOURCE_KIND_FILE.to_string()
}

/// 插件的一个可配置项。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginOption {
    pub key: String,
    pub label: String,
    /// `text` / `number` / `bool` / `select`，前端按这个渲染输入控件。
    #[serde(default = "default_option_kind")]
    pub kind: String,
    #[serde(default)]
    pub default: String,
    /// `select` 类型的候选项；其他类型忽略。
    #[serde(default)]
    pub choices: Vec<String>,
    /// `select` 候选项的显示文案：候选值 -> 显示给用户的名字。
    ///
    /// 写了这个才显示中文名；没写就原样显示候选值，老插件不用改也能用。
    #[serde(default)]
    pub choice_labels: BTreeMap<String, String>,
    /// 说明文字，写给用户看，渲染在选项下面。
    #[serde(default)]
    pub help: String,
    /// 是不是「高级选项」：前端收进折叠区，默认不展开。
    ///
    /// 普通用户看到的是一排看不懂的技术项，藏起来比摆在那儿强。
    #[serde(default)]
    pub advanced: bool,
    /// 是不是敏感内容（令牌、口令）：前端用密码框渲染，不明文回显。
    #[serde(default)]
    pub secret: bool,
}

/// 插件自带的一个资源文件。
///
/// 资源随应用内置（`resources/plugins/<id>/<path>`），安装插件时解包到
/// 插件目录下的 `resources/`。功能代码仍然写在主程序里，插件本身不执行代码。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginResource {
    /// 资源在插件目录里的相对路径，例如 `catalog.json`。
    pub path: String,
    /// 资源类型：`file`（默认）或 `textbook_catalog`（教材清单）。
    #[serde(default = "default_resource_kind")]
    pub kind: String,
    /// 这个资源是什么，写给用户看。
    #[serde(default)]
    pub description: String,
}

/// 插件包清单：仓库里 `resources/plugins/<id>.json` 的内容。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginPackage {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
    /// 工具箱网格里的图标（一个 emoji 或短字符），没写就回退到首字母。
    #[serde(default)]
    pub icon: String,
    /// 装上之后能多出来的能力，用短句写给用户看。
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub options: Vec<PluginOption>,
    /// 插件自带的资源文件，安装时解包到插件目录。
    #[serde(default)]
    pub resources: Vec<PluginResource>,
}

/// 工具箱列表里展示的一个插件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub summary: String,
    pub author: String,
    pub version: String,
    pub icon: String,
    pub size_kb: u32,
    pub capabilities: Vec<String>,
    pub options: Vec<PluginOption>,
    pub resources: Vec<PluginResource>,
    pub installed: bool,
}

/// 插件选项的当前值：没设置过就用包里的默认值。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginOptionValue {
    pub key: String,
    pub label: String,
    pub kind: String,
    pub value: String,
}

/// 解析并校验一个插件包。文件名即插件 id，包里的 id 必须一致。
fn parse_package(id: &str, raw: &str) -> Result<PluginPackage, String> {
    let package: PluginPackage =
        serde_json::from_str(raw).map_err(|err| format!("插件 {id} 解析失败：{err}"))?;
    if package.id.trim() != id {
        return Err(format!("插件 {id} 的 id 与文件名不一致"));
    }
    if package.name.trim().is_empty() {
        return Err(format!("插件 {id} 缺少名称"));
    }
    for option in &package.options {
        if option.key.trim().is_empty() {
            return Err(format!("插件 {id} 有空的选项 key"));
        }
        if option.label.trim().is_empty() {
            return Err(format!("插件 {id} 的选项 {} 缺少名称", option.key));
        }
        if option.kind == "select" && option.choices.is_empty() {
            return Err(format!(
                "插件 {id} 的选项 {} 是下拉框但没有候选值",
                option.key
            ));
        }
    }
    for resource in &package.resources {
        if !is_safe_relative_path(&resource.path) {
            return Err(format!("插件 {id} 的资源路径不合法：{}", resource.path));
        }
    }
    Ok(package)
}

/// 资源路径必须是干净的相对路径：不能为空、不能是绝对路径、不能带 `..` 回退。
/// 逐段检查而不是简单找 `..`，免得把名字里带 `..` 的正常文件也当成越界。
fn is_safe_relative_path(path: &str) -> bool {
    let path = path.trim();
    if path.is_empty() || Path::new(path).is_absolute() {
        return false;
    }
    !path
        .split(['/', '\\'])
        .any(|segment| segment == ".." || segment == ".")
}

/// 插件内置的资源文件：相对路径 + 内容。
pub fn builtin_plugin_resources(plugin_id: &str) -> Vec<(&'static str, &'static str)> {
    BUILTIN_PLUGIN_RESOURCES
        .iter()
        .filter(|(id, _, _)| *id == plugin_id)
        .map(|(_, path, content)| (*path, *content))
        .collect()
}

/// 插件包的总大小：清单 + 资源。
fn plugin_size_kb(plugin_id: &str, manifest: &str) -> u32 {
    let resources: usize = builtin_plugin_resources(plugin_id)
        .iter()
        .map(|(_, content)| content.len())
        .sum();
    ((manifest.len() + resources) / 1024).max(1) as u32
}

/// 仓库里的全部插件包。解析失败直接报错，不静默跳过坏包。
pub fn builtin_packages() -> Result<Vec<(PluginPackage, u32)>, String> {
    BUILTIN_PLUGIN_PACKAGES
        .iter()
        .map(|(id, raw)| {
            let package = parse_package(id, raw)?;
            let size_kb = plugin_size_kb(id, raw);
            Ok((package, size_kb))
        })
        .collect()
}

/// 仓库里的某个插件包；找不到返回 None。
pub fn builtin_package(id: &str) -> Result<Option<(PluginPackage, &'static str)>, String> {
    let id = id.trim();
    let Some((key, raw)) = BUILTIN_PLUGIN_PACKAGES.iter().find(|(key, _)| *key == id) else {
        return Ok(None);
    };
    Ok(Some((parse_package(key, raw)?, *raw)))
}

/// 已安装插件 id 列表。settings 里是坏 JSON 时按「没装」处理，不让整个工具箱打不开。
pub fn installed_plugin_ids(conn: &Connection) -> Vec<String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![INSTALLED_PLUGINS_KEY],
            |row| row.get(0),
        )
        .unwrap_or(None);
    let Some(raw) = raw else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default()
}

/// 覆盖写入已安装插件 id 列表。
fn save_installed_plugin_ids(conn: &Connection, ids: &[String]) -> Result<(), String> {
    let value = serde_json::to_string(ids).map_err(|err| err.to_string())?;
    conn.execute(
        r#"INSERT INTO app_settings (key, value, updated_at)
           VALUES (?1, ?2, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = excluded.updated_at"#,
        params![INSTALLED_PLUGINS_KEY, value],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

/// 工具箱插件列表：仓库里的全部插件，标出哪些已经装好。
pub fn list_plugins_impl(conn: &Connection) -> Result<Vec<PluginInfo>, String> {
    let installed = installed_plugin_ids(conn);
    let mut plugins = Vec::new();
    for (package, size_kb) in builtin_packages()? {
        plugins.push(PluginInfo {
            installed: installed.iter().any(|id| id == &package.id),
            id: package.id,
            name: package.name,
            summary: package.summary,
            author: package.author,
            version: package.version,
            icon: package.icon,
            size_kb,
            capabilities: package.capabilities,
            options: package.options,
            resources: package.resources,
        });
    }
    Ok(plugins)
}

/// 安装插件：把包写进 `plugins_dir/<id>/plugin.json` 并登记。
/// 插件自带的资源文件一并解包到 `plugins_dir/<id>/resources/`。
/// 重复安装是幂等的：文件覆盖写，列表里不会多出第二行。
pub fn install_plugin_impl(
    conn: &Connection,
    plugins_dir: &Path,
    id: &str,
) -> Result<PluginInfo, String> {
    let id = id.trim();
    let Some((package, raw)) = builtin_package(id)? else {
        return Err(format!("插件仓库里没有 {id}"));
    };
    let target_dir = plugins_dir.join(&package.id);
    std::fs::create_dir_all(&target_dir).map_err(|err| format!("创建插件目录失败：{err}"))?;
    std::fs::write(target_dir.join(PLUGIN_PACKAGE_FILE), raw)
        .map_err(|err| format!("写入插件文件失败：{err}"))?;
    unpack_plugin_resources(&target_dir, &package.id)?;

    let mut ids = installed_plugin_ids(conn);
    if !ids.iter().any(|existing| existing == &package.id) {
        ids.push(package.id.clone());
    }
    save_installed_plugin_ids(conn, &ids)?;

    let size_kb = plugin_size_kb(&package.id, raw);
    Ok(PluginInfo {
        installed: true,
        id: package.id,
        name: package.name,
        summary: package.summary,
        author: package.author,
        version: package.version,
        icon: package.icon,
        size_kb,
        capabilities: package.capabilities,
        options: package.options,
        resources: package.resources,
    })
}

/// 把插件内置的资源文件解包到插件目录。
///
/// 先清空旧的 `resources/` 目录，免得清单里删掉的文件还留在磁盘上。
fn unpack_plugin_resources(plugin_dir: &Path, plugin_id: &str) -> Result<(), String> {
    let resources_dir = plugin_dir.join(PLUGIN_RESOURCES_DIR);
    if resources_dir.exists() {
        std::fs::remove_dir_all(&resources_dir)
            .map_err(|err| format!("清理插件资源目录失败：{err}"))?;
    }
    let resources = builtin_plugin_resources(plugin_id);
    if resources.is_empty() {
        return Ok(());
    }
    std::fs::create_dir_all(&resources_dir)
        .map_err(|err| format!("创建插件资源目录失败：{err}"))?;
    for (path, content) in resources {
        let file = resources_dir.join(path);
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("创建插件资源目录失败：{err}"))?;
        }
        std::fs::write(&file, content).map_err(|err| format!("写入插件资源失败：{err}"))?;
    }
    Ok(())
}

/// 读插件资源的内容。
///
/// 优先用安装后解包到本地的副本，没有就用内置的那份，
/// 所以插件还没装也能读清单。
pub fn plugin_resource_text(
    plugins_dir: &Path,
    plugin_id: &str,
    path: &str,
) -> Result<String, String> {
    let plugin_id = plugin_id.trim();
    let path = path.trim();
    if !is_safe_relative_path(path) {
        return Err(format!("资源路径不合法：{path}"));
    }
    let local = plugins_dir
        .join(plugin_id)
        .join(PLUGIN_RESOURCES_DIR)
        .join(path);
    if local.is_file() {
        return std::fs::read_to_string(&local).map_err(|err| format!("读取插件资源失败：{err}"));
    }
    let Some((_, content)) = builtin_plugin_resources(plugin_id)
        .into_iter()
        .find(|(resource_path, _)| *resource_path == path)
    else {
        return Err(format!("插件 {plugin_id} 里没有资源 {path}"));
    };
    Ok(content.to_string())
}

/// 卸载插件：删掉安装目录并从登记里移除。插件本来就没装时也算成功。
pub fn uninstall_plugin_impl(
    conn: &Connection,
    plugins_dir: &Path,
    id: &str,
) -> Result<(), String> {
    let id = id.trim();
    let target_dir = plugins_dir.join(id);
    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir).map_err(|err| format!("删除插件目录失败：{err}"))?;
    }
    let ids: Vec<String> = installed_plugin_ids(conn)
        .into_iter()
        .filter(|existing| existing != id)
        .collect();
    save_installed_plugin_ids(conn, &ids)?;
    Ok(())
}

/// 插件选项在 settings 里的 key。
pub fn plugin_option_key(plugin_id: &str, key: &str) -> String {
    format!("{PLUGIN_OPTION_PREFIX}{plugin_id}.{key}")
}

/// 读插件选项：没设置过就用包里的默认值。
pub fn plugin_options_impl(
    conn: &Connection,
    plugin_id: &str,
) -> Result<Vec<PluginOptionValue>, String> {
    let plugin_id = plugin_id.trim();
    let Some((package, _)) = builtin_package(plugin_id)? else {
        return Err(format!("插件仓库里没有 {plugin_id}"));
    };
    let mut values = Vec::with_capacity(package.options.len());
    for option in package.options {
        let stored: Option<String> = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                params![plugin_option_key(&package.id, &option.key)],
                |row| row.get(0),
            )
            .unwrap_or(None);
        values.push(PluginOptionValue {
            key: option.key.clone(),
            label: option.label.clone(),
            kind: option.kind.clone(),
            value: stored.unwrap_or_else(|| option.default.clone()),
        });
    }
    Ok(values)
}

/// 写插件选项。只接受仓库里声明过的选项，避免 settings 里堆垃圾 key。
pub fn set_plugin_option_impl(
    conn: &Connection,
    plugin_id: &str,
    key: &str,
    value: &str,
) -> Result<(), String> {
    let plugin_id = plugin_id.trim();
    let Some((package, _)) = builtin_package(plugin_id)? else {
        return Err(format!("插件仓库里没有 {plugin_id}"));
    };
    if !package.options.iter().any(|option| option.key == key) {
        return Err(format!("插件 {plugin_id} 没有选项 {key}"));
    }
    conn.execute(
        r#"INSERT INTO app_settings (key, value, updated_at)
           VALUES (?1, ?2, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = excluded.updated_at"#,
        params![plugin_option_key(&package.id, key), value],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

/// 插件安装目录：`appData/plugins`。
pub fn plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("plugins");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}
