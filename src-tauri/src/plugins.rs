//! 工具箱插件：内置插件仓库 + 本地安装。
//!
//! 插件包放在 `resources/plugins/*.json`，由 `build.rs` 嵌入二进制，
//! 所以打包后的应用和测试读到的是同一份仓库清单，不依赖运行目录。
//! 一个文件就是一个插件：文件名是插件 id，文件内容是插件清单。
//!
//! 安装 = 把插件包落到 `appData/plugins/<id>/plugin.json`，并登记到 settings；
//! 卸载 = 删掉这个目录并从登记里移除。已安装列表存在 settings 里，
//! 不新增数据表，导出 / 导入不受影响。

use crate::commands::app_settings::{
    clean_list_setting, set_list_setting_impl, TRACK_MISTAKE_REASONS_SETTING_KEY,
    TRACK_METHODS_SETTING_KEY,
};
use crate::commands::goals::{GOAL_KIND_EXAM, GOAL_KINDS};
use crate::commands::tracks::{
    TRACK_KIND_EXAM, TRACK_KINDS, TRACK_SCORE_MODES, TRACK_SCORE_MODE_TOTAL,
};
use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
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

/// 资源类型：动机语料包（JSON，赛道包专用）。
pub const PLUGIN_RESOURCE_KIND_MOTIVATION_PACK: &str = "motivation_pack";

/// 插件类型：普通工具插件（默认）。
pub const PLUGIN_KIND_PLUGIN: &str = "plugin";

/// 插件类型：赛道包。装上就多一条赛道 + 一套科目 + 一组目标。
pub const PLUGIN_KIND_TRACK: &str = "track";

fn default_plugin_kind() -> String {
    PLUGIN_KIND_PLUGIN.to_string()
}

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

/// 赛道包提供的赛道定义。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrackSeed {
    pub name: String,
    /// 对应 `tracks.kind`：exam / skill / course。
    #[serde(default)]
    pub kind: Option<String>,
    /// 对应 `tracks.score_mode`：total / per_subject / band。
    #[serde(default)]
    pub score_mode: Option<String>,
    /// 装上就把它设成主赛道。
    #[serde(default)]
    pub is_primary: Option<bool>,
    #[serde(default)]
    pub color: Option<String>,
}

/// 赛道包提供的科目。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubjectSeed {
    /// 科目标识，全库唯一。
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub full_mark: Option<f64>,
    /// 不写就等于满分。
    #[serde(default)]
    pub goal: Option<f64>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub order_index: Option<i64>,
}

/// 目标日期规则。
///
/// 规则只说「一年里的哪一天」（`MM-DD`），不带任何学科知识：
/// 高考是 6 月 7 日，别的赛道可以在自己的包里声明别的日子。
/// 年级偏移（高一往后推 2 年……）也写在规则里，前端按用户选的年级算。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DateRule {
    pub id: String,
    /// `MM-DD`。
    pub anchor: String,
    #[serde(default)]
    pub grade_offsets: BTreeMap<String, i64>,
}

/// 赛道包提供的目标。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoalSeed {
    pub name: String,
    /// 写死日期就用它；不给就按 `date_rule` 算最近的一次。
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub is_primary: Option<bool>,
    #[serde(default)]
    pub target_score: Option<f64>,
    /// 目标日期规则。规则本身不含学科知识，只是日历 + 年级偏移。
    #[serde(default)]
    pub date_rule: Option<DateRule>,
}

/// 赛道包提供的内容。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TrackProvides {
    #[serde(default)]
    pub track: Option<TrackSeed>,
    #[serde(default)]
    pub subjects: Vec<SubjectSeed>,
    #[serde(default)]
    pub goals: Vec<GoalSeed>,
    /// 动机语料包的资源路径。
    #[serde(default)]
    pub motivation_pack: Option<String>,
    /// 赛道级错因白名单。装上就写进 `app_settings`，前后端读同一份。
    #[serde(default)]
    pub mistake_reasons: Option<Vec<String>>,
    /// 赛道级学习方式。装上就写进 `app_settings`。
    #[serde(default)]
    pub methods: Option<Vec<String>>,
}

/// 插件包清单：仓库里 `resources/plugins/<id>.json` 的内容。
///
/// 这里没有 `Eq`：赛道包带的科目种子里有分数（f64），浮点不实现 Eq。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// 插件类型：`plugin`（普通工具）或 `track`（赛道包）。
    #[serde(default = "default_plugin_kind")]
    pub kind: String,
    /// 赛道包提供的内容。`kind == "track"` 时才有值。
    #[serde(default)]
    pub provides: Option<TrackProvides>,
}

/// 工具箱列表里展示的一个插件。
///
/// 和 `PluginPackage` 一样不带 `Eq`：赛道包的科目种子带分数（f64）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// 插件类型：`plugin` 或 `track`。
    pub kind: String,
    /// 赛道包提供的内容。
    pub provides: Option<TrackProvides>,
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
    if package.kind != PLUGIN_KIND_PLUGIN && package.kind != PLUGIN_KIND_TRACK {
        return Err(format!("插件 {id} 的类型不合法：{}", package.kind));
    }
    if package.kind == PLUGIN_KIND_TRACK && package.provides.is_none() {
        return Err(format!("赛道包 {id} 缺少 provides"));
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

/// 插件 id 必须是单个安全目录名，不能带分隔符或回退段。
/// 不能只查内置白名单：图谱类功能允许测试/外部目录里放同名结构的插件资源。
fn is_safe_plugin_id(id: &str) -> bool {
    let id = id.trim();
    !id.is_empty()
        && !Path::new(id).is_absolute()
        && !id.contains(['/', '\\'])
        && id != "."
        && id != ".."
        && !id.chars().any(char::is_control)
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
            kind: package.kind,
            provides: package.provides,
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

    // 赛道包：装上就把赛道、科目、目标播种进库（幂等）。
    // 播种失败就当装失败 —— 半套赛道比没装更麻烦。
    if package.kind == PLUGIN_KIND_TRACK {
        if let Some(provides) = package.provides.as_ref() {
            seed_track_provides(conn, provides)?;
        }
    }

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
        kind: package.kind,
        provides: package.provides,
    })
}

/// 赛道包安装时把赛道、科目、目标播种进库（幂等）。
///
/// 幂等靠三个自然键：赛道按 `tracks.name`、科目按 `subjects.key`、
/// 目标按（赛道 + 名称）。已存在的行不动 —— 用户改过的满分与目标
/// 不该被「装个插件」这件事覆盖掉。
pub fn seed_track_provides(
    conn: &Connection,
    provides: &TrackProvides,
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|err| err.to_string())?;
    let track_id = match &provides.track {
        Some(seed) => Some(seed_track(&tx, seed)?),
        None => primary_track_id(&tx)?,
    };
    for (index, subject) in provides.subjects.iter().enumerate() {
        seed_subject(&tx, track_id, subject, index)?;
    }
    for goal in &provides.goals {
        seed_goal(&tx, track_id, goal)?;
    }
    seed_track_content(&tx, provides)?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(())
}

/// 赛道包里的语料配置：错因白名单、学习方式。
///
/// 写进 `app_settings`，前端读同一份（`useMistakeReasons` / `useStudyMethods`）。
/// 空的清单不写：宁可继续用内置的，也不要把用户已有的配置清空。
fn seed_track_content(tx: &Transaction<'_>, provides: &TrackProvides) -> Result<(), String> {
    if let Some(reasons) = provides.mistake_reasons.as_ref() {
        let list = clean_list_setting(reasons);
        if !list.is_empty() {
            set_list_setting_impl(tx, TRACK_MISTAKE_REASONS_SETTING_KEY, &list)?;
        }
    }
    if let Some(methods) = provides.methods.as_ref() {
        let list = clean_list_setting(methods);
        if !list.is_empty() {
            set_list_setting_impl(tx, TRACK_METHODS_SETTING_KEY, &list)?;
        }
    }
    Ok(())
}

/// 当前主赛道的 id。没有主赛道就是 None。
fn primary_track_id(tx: &Transaction<'_>) -> Result<Option<i64>, String> {
    tx.query_row(
        "SELECT id FROM tracks WHERE is_primary = 1 ORDER BY id ASC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())
}

/// 播种一条赛道。同名赛道直接复用，不改用户改过的名字。
fn seed_track(tx: &Transaction<'_>, seed: &TrackSeed) -> Result<i64, String> {
    let name = seed.name.trim();
    if name.is_empty() {
        return Err("赛道包的赛道名称不能为空".to_string());
    }
    let existing: Option<i64> = tx
        .query_row(
            "SELECT id FROM tracks WHERE name = ?1",
            params![name],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let id = match existing {
        Some(id) => id,
        None => {
            let kind = pick_allowed(seed.kind.as_deref(), &TRACK_KINDS, TRACK_KIND_EXAM);
            let score_mode = pick_allowed(
                seed.score_mode.as_deref(),
                &TRACK_SCORE_MODES,
                TRACK_SCORE_MODE_TOTAL,
            );
            tx.execute(
                "INSERT INTO tracks (name, kind, score_mode, color) VALUES (?1, ?2, ?3, ?4)",
                params![name, kind, score_mode, seed.color],
            )
            .map_err(|err| err.to_string())?;
            tx.last_insert_rowid()
        }
    };
    if seed.is_primary.unwrap_or(false) {
        tx.execute(
            "UPDATE tracks SET is_primary = CASE WHEN id = ?1 THEN 1 ELSE 0 END",
            params![id],
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(id)
}

/// 播种一科。同 key 的科目已经存在就跳过：用户改过的满分与目标留着。
fn seed_subject(
    tx: &Transaction<'_>,
    track_id: Option<i64>,
    seed: &SubjectSeed,
    index: usize,
) -> Result<(), String> {
    let key = seed.key.trim();
    let label = seed.label.trim();
    if key.is_empty() || label.is_empty() {
        return Err("赛道包的科目要同时给 key 和名称".to_string());
    }
    let existing: Option<i64> = tx
        .query_row(
            "SELECT id FROM subjects WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    if existing.is_some() {
        return Ok(());
    }
    let goal = seed.goal.or(seed.full_mark);
    let order_index = seed.order_index.unwrap_or(index as i64);
    let unit = seed.unit.clone().unwrap_or_else(|| "分".to_string());
    tx.execute(
        "INSERT INTO subjects (key, label, full_mark, goal, unit, order_index, track_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![key, label, seed.full_mark, goal, unit, order_index, track_id],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

/// 播种一个目标。同名同赛道的目标已经存在就跳过。
fn seed_goal(
    tx: &Transaction<'_>,
    track_id: Option<i64>,
    seed: &GoalSeed,
) -> Result<(), String> {
    let name = seed.name.trim();
    if name.is_empty() {
        return Err("赛道包的目标名称不能为空".to_string());
    }
    let Some(date) = seed_date(seed) else {
        // 既没写死日期也没有规则：等前端按用户选的年级补上，先不种。
        return Ok(());
    };
    let existing: Option<i64> = tx
        .query_row(
            "SELECT id FROM goals WHERE name = ?1 AND (track_id = ?2 OR track_id IS NULL)",
            params![name, track_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    if existing.is_some() {
        return Ok(());
    }
    let kind = pick_allowed(seed.kind.as_deref(), &GOAL_KINDS, GOAL_KIND_EXAM);
    tx.execute(
        "INSERT INTO goals (track_id, name, date, kind, is_primary, target_score)
         VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![track_id, name, date, kind, seed.target_score],
    )
    .map_err(|err| err.to_string())?;
    let id = tx.last_insert_rowid();
    if seed.is_primary.unwrap_or(false) {
        tx.execute(
            "UPDATE goals SET is_primary = CASE WHEN id = ?1 THEN 1 ELSE 0 END",
            params![id],
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// 白名单里的值才认；空值或不认识的值退回默认值。
fn pick_allowed<'a>(raw: Option<&'a str>, allowed: &[&str], fallback: &'a str) -> &'a str {
    let value = raw.unwrap_or("").trim();
    if value.is_empty() {
        return fallback;
    }
    if allowed.contains(&value) {
        value
    } else {
        fallback
    }
}

/// 目标日期：包里写死了就用写死的；只给规则就按规则算最近的一次。
fn seed_date(seed: &GoalSeed) -> Option<String> {
    if let Some(date) = seed
        .date
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(date.to_string());
    }
    let rule = seed.date_rule.as_ref()?;
    let (month, day) = parse_rule_anchor(&rule.anchor)?;
    let today = chrono::Local::now().date_naive();
    let mut candidate = NaiveDate::from_ymd_opt(today.year(), month, day)?;
    if candidate < today {
        candidate = NaiveDate::from_ymd_opt(today.year() + 1, month, day)?;
    }
    Some(candidate.format("%Y-%m-%d").to_string())
}

/// 规则锚点 `MM-DD`。规则本身不含学科知识，这里只认日历。
fn parse_rule_anchor(anchor: &str) -> Option<(u32, u32)> {
    let (month, day) = anchor.trim().split_once('-')?;
    let month: u32 = month.trim().parse().ok()?;
    let day: u32 = day.trim().parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some((month, day))
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
    // 资源路径校验只管住了 path，id 带 `../` 时仍能把读取基目录挪到
    // appData 之外；这里只要求它是单个安全目录名，不限制必须是内置插件。
    if !is_safe_plugin_id(plugin_id) {
        return Err(format!("插件 id 不合法：{plugin_id}"));
    }
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
    // id 带 `../` 时，下面的 remove_dir_all 会删到 appData 之外。
    // 未知但安全的 id 仍然幂等成功，只是没有目录可删。
    if !is_safe_plugin_id(id) {
        return Err(format!("插件 id 不合法：{id}"));
    }
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
