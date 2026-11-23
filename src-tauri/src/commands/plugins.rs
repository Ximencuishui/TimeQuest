use crate::db::{with_db, DbState};
use crate::plugins::{
    builtin_package, install_plugin_impl, list_plugins_impl, plugin_options_impl,
    plugin_resource_text, plugins_dir, set_plugin_option_impl, uninstall_plugin_impl, PluginInfo,
    PluginOptionValue, PLUGIN_RESOURCE_KIND_MOTIVATION_PACK,
    PLUGIN_RESOURCE_KIND_TEXTBOOK_CATALOG,
};
use crate::textbook_source::{
    download_textbook, parse_textbook_catalog, textbook_download_plan, textbooks_dir,
    DownloadProgress, DownloadRetryPolicy, DownloadSource, DownloadedTextbook, TextbookCatalog,
};
use tauri::{AppHandle, Emitter, Manager, State};

/// 工具箱里的插件列表（内置仓库 + 已安装标记）。
#[tauri::command]
pub fn list_plugins(state: State<'_, DbState>) -> Result<Vec<PluginInfo>, String> {
    with_db(&state, list_plugins_impl)
}

/// 下载并安装一个插件：包落到 `appData/plugins/<id>/plugin.json`。
#[tauri::command]
pub fn install_plugin(
    app: AppHandle,
    state: State<'_, DbState>,
    id: String,
) -> Result<PluginInfo, String> {
    let dir = plugins_dir(&app)?;
    with_db(&state, |conn| install_plugin_impl(conn, &dir, &id))
}

/// 卸载插件：删掉安装目录并从登记里移除。
#[tauri::command]
pub fn uninstall_plugin(
    app: AppHandle,
    state: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let dir = plugins_dir(&app)?;
    with_db(&state, |conn| uninstall_plugin_impl(conn, &dir, &id))
}

/// 读插件选项：没设置过就用包里的默认值。
#[tauri::command]
pub fn list_plugin_options(
    state: State<'_, DbState>,
    plugin_id: String,
) -> Result<Vec<PluginOptionValue>, String> {
    with_db(&state, |conn| plugin_options_impl(conn, &plugin_id))
}

/// 写插件选项。
#[tauri::command]
pub fn set_plugin_option(
    state: State<'_, DbState>,
    plugin_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    with_db(&state, |conn| {
        set_plugin_option_impl(conn, &plugin_id, &key, &value)
    })
}

/// 读插件自带的资源文件内容。
///
/// 插件没装也能读：优先用安装后解包到本地的副本，没有就回落到内置的那份。
/// 路径必须是资源清单里声明过的相对路径，`..` 和绝对路径都会被拒绝。
#[tauri::command]
pub fn read_plugin_resource(
    app: AppHandle,
    plugin_id: String,
    path: String,
) -> Result<String, String> {
    let dir = plugins_dir(&app)?;
    plugin_resource_text(&dir, &plugin_id, &path)
}

/// 读插件自带的动机语料包。
///
/// 赛道包可以带一份自己的每日一句（`kind = "motivation_pack"`）。
/// 插件没装也能读：读不到本地副本就回落到内置的那份。
#[tauri::command]
pub fn read_plugin_motivation_pack(
    app: AppHandle,
    plugin_id: String,
) -> Result<String, String> {
    let dir = plugins_dir(&app)?;
    let resource = motivation_pack_resource(&plugin_id)?;
    plugin_resource_text(&dir, &plugin_id, &resource)
}

/// 找到插件声明的动机语料包资源路径。
fn motivation_pack_resource(plugin_id: &str) -> Result<String, String> {
    let id = plugin_id.trim();
    let Some((package, _)) = builtin_package(id)? else {
        return Err(format!("插件仓库里没有 {id}"));
    };
    package
        .resources
        .iter()
        .find(|resource| resource.kind == PLUGIN_RESOURCE_KIND_MOTIVATION_PACK)
        .map(|resource| resource.path.clone())
        .ok_or_else(|| format!("插件 {id} 没有动机语料包"))
}

/// 下载进度事件的名称，前端靠它更新进度条。
pub const TEXTBOOK_DOWNLOAD_PROGRESS_EVENT: &str = "textbook-download-progress";

/// 插件选项：下载源。
pub const PLUGIN_OPTION_DOWNLOAD_SOURCE: &str = "download_source";

/// 插件选项：GitHub token（选填，用来提高下载限额）。
pub const PLUGIN_OPTION_GITHUB_TOKEN: &str = "github_token";

/// 教材源插件的教材清单。
///
/// 清单是插件自带的一个 JSON 资源文件，描述可下载的教材。
/// 插件没装也能读：读不到本地副本就回落到内置的那份。
#[tauri::command]
pub fn list_plugin_textbook_catalog(
    app: AppHandle,
    plugin_id: String,
) -> Result<TextbookCatalog, String> {
    let dir = plugins_dir(&app)?;
    let resource = textbook_catalog_resource(&plugin_id)?;
    let raw = plugin_resource_text(&dir, &plugin_id, &resource)?;
    parse_textbook_catalog(&raw)
}

/// 按需下载某本教材，落到 `appData/textbooks/<插件 id>/`。
///
/// 只下用户点的那一本：完整书下完一个文件，分片书按顺序接成一个 PDF。
/// 进度通过 `textbook-download-progress` 事件报给前端。
#[tauri::command]
pub async fn download_plugin_textbook(
    app: AppHandle,
    state: State<'_, DbState>,
    plugin_id: String,
    path: String,
) -> Result<DownloadedTextbook, String> {
    let dir = plugins_dir(&app)?;
    let resource = textbook_catalog_resource(&plugin_id)?;
    let raw = plugin_resource_text(&dir, &plugin_id, &resource)?;
    let catalog = parse_textbook_catalog(&raw)?;
    let book = catalog
        .find(&path)
        .ok_or_else(|| format!("教材清单里没有 {path}"))?
        .clone();

    let options = with_db(&state, |conn| textbook_download_options(conn, &plugin_id))?;
    // 首选源按插件选项，另一个源当备用：断了可以换源接着传。
    let plan = textbook_download_plan(&catalog, &book, options.source)?;

    let app_data = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let target_dir = textbooks_dir(&app_data, &plugin_id)?;

    let emitter = app.clone();
    download_textbook(
        &target_dir,
        &book,
        &plan,
        options.token.as_deref(),
        DownloadRetryPolicy::default(),
        move |progress: DownloadProgress| {
            let _ = emitter.emit(TEXTBOOK_DOWNLOAD_PROGRESS_EVENT, progress);
        },
    )
    .await
}

/// 教材下载相关的插件选项。
struct TextbookDownloadOptions {
    source: DownloadSource,
    /// GitHub token 是选填的，没填就匿名下载。
    token: Option<String>,
}

/// 从插件选项里读下载源和 token。
fn textbook_download_options(
    conn: &rusqlite::Connection,
    plugin_id: &str,
) -> Result<TextbookDownloadOptions, String> {
    let options = plugin_options_impl(conn, plugin_id)?;
    let value_of = |key: &str| {
        options
            .iter()
            .find(|option| option.key == key)
            .map(|option| option.value.trim().to_string())
    };
    let source =
        DownloadSource::parse(&value_of(PLUGIN_OPTION_DOWNLOAD_SOURCE).unwrap_or_default());
    let token = value_of(PLUGIN_OPTION_GITHUB_TOKEN).filter(|token| !token.is_empty());
    Ok(TextbookDownloadOptions { source, token })
}

/// 找到插件声明的教材清单资源。
fn textbook_catalog_resource(plugin_id: &str) -> Result<String, String> {
    let id = plugin_id.trim();
    let Some((package, _)) = builtin_package(id)? else {
        return Err(format!("插件仓库里没有 {id}"));
    };
    package
        .resources
        .iter()
        .find(|resource| resource.kind == PLUGIN_RESOURCE_KIND_TEXTBOOK_CATALOG)
        .map(|resource| resource.path.clone())
        .ok_or_else(|| format!("插件 {id} 没有教材清单"))
}
