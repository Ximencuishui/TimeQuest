//! 知识图谱插件的命令：浏览知识点、看前置、按需下载其余学科。
//!
//! 数学、物理随应用内置，不联网就能用。其余学科点下载时从上游仓库
//! 拉全量数据文件，再按 id 前缀切出这个学科，落到插件目录缓存起来。

use crate::db::{with_db, DbState};
use crate::knowledge_graph::{
    filter_topics, parse_dependencies, parse_packs, parse_topics, slice_dependencies_by_prefix,
    slice_topics_by_prefix, KnowledgeDependenciesFile, KnowledgeGraph, KnowledgePack, KnowledgePacks,
    KnowledgeTopicsFile, KnowledgeTopic, PrerequisiteNode, TopicFilter, STRENGTH_HARD,
};
use crate::commands::plugins::{PLUGIN_OPTION_DOWNLOAD_SOURCE, PLUGIN_OPTION_GITHUB_TOKEN};
use crate::models::{TopicMistake, TopicMistakes};
use crate::plugins::{plugin_options_impl, plugin_resource_text, plugins_dir};
use crate::textbook_source::{
    download_error_message, encode_repo_path, DownloadSource, GITHUB_BLOB_ACCEPT,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// 学科包清单这个资源的文件名。插件清单里声明的就是它。
pub const KNOWLEDGE_PACKS_RESOURCE: &str = "packs.json";

/// 下载进度事件名，前端靠它更新进度条。
pub const KNOWLEDGE_PACK_DOWNLOAD_PROGRESS_EVENT: &str = "knowledge-pack-download-progress";

/// 下载缓存放在插件目录下的子目录名。
const KNOWLEDGE_PACKS_DIR: &str = "packs";

/// 上游原始数据文件的缓存目录名。
///
/// 上游只发布全量文件，所以下载一次就是 4MB 出头。缓存下原始文件，
/// 之后点别的学科直接切本地副本，不用再拉一遍。
const KNOWLEDGE_RAW_DIR: &str = "_raw";

/// 一个学科包在工具箱里的状态。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgePackEntry {
    pub subject: String,
    pub name: String,
    /// 这个学科有多少个知识点。
    pub count: usize,
    /// `builtin` 随应用内置，`downloaded` 已下载到本地，`available` 还没下载。
    pub state: String,
    /// 是不是随应用内置的学科。
    pub builtin: bool,
}

/// 某个知识点的先修信息。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrerequisiteResult {
    /// 查的这个知识点本身。
    pub topic: KnowledgeTopic,
    /// 直接先修，硬的在前。
    pub direct: Vec<PrerequisiteNode>,
    /// 沿硬先修回溯到的深层前置。
    pub ancestors: Vec<PrerequisiteNode>,
}

/// 下载进度。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDownloadProgress {
    pub subject: String,
    /// `topics` 或 `dependencies`。
    pub file: String,
    pub downloaded: u64,
    pub total: u64,
}

/// 工具箱里的学科包清单：哪些内置了、哪些下载过、哪些还没下。
#[tauri::command]
pub fn list_plugin_knowledge_packs(
    app: AppHandle,
    plugin_id: String,
) -> Result<Vec<KnowledgePackEntry>, String> {
    let dir = plugins_dir(&app)?;
    let packs = load_packs(&dir, &plugin_id)?;
    let mut entries: Vec<KnowledgePackEntry> = Vec::new();
    for pack in packs.builtin.iter().chain(packs.downloadable.iter()) {
        let builtin = packs.builtin.iter().any(|item| item.subject == pack.subject);
        let downloaded = downloaded_pack_exists(&dir, &plugin_id, &pack.subject);
        let state = if builtin {
            "builtin"
        } else if downloaded {
            "downloaded"
        } else {
            "available"
        };
        entries.push(KnowledgePackEntry {
            subject: pack.subject.clone(),
            name: pack.name.clone(),
            count: pack.count,
            state: state.to_string(),
            builtin,
        });
    }
    Ok(entries)
}

/// 浏览某个学科的知识点。
///
/// 学科没下载过就报错，提示去下载，不返回空列表装作「这个学科没有知识点」。
#[tauri::command]
pub fn list_plugin_knowledge_points(
    app: AppHandle,
    plugin_id: String,
    subject: String,
    stage: Option<String>,
    query: Option<String>,
) -> Result<Vec<KnowledgeTopic>, String> {
    let dir = plugins_dir(&app)?;
    let subject = subject.trim().to_string();
    let graph = load_graph(&dir, &plugin_id, &subject)?;
    let filter = TopicFilter {
        stage: stage.filter(|value| !value.trim().is_empty()),
        query: query.filter(|value| !value.trim().is_empty()),
    };
    Ok(filter_topics(&graph.topics, &filter))
}

/// 查某个知识点的先修：直接先修 + 沿硬先修回溯出的深层前置。
#[tauri::command]
pub fn list_plugin_prerequisites(
    app: AppHandle,
    plugin_id: String,
    subject: String,
    topic_id: String,
) -> Result<PrerequisiteResult, String> {
    let dir = plugins_dir(&app)?;
    let subject = subject.trim().to_string();
    let topic_id = topic_id.trim().to_string();
    let graph = load_graph(&dir, &plugin_id, &subject)?;
    let topic = graph
        .topic(&topic_id)
        .cloned()
        .ok_or_else(|| format!("这个学科里没有 {topic_id}"))?;
    Ok(PrerequisiteResult {
        direct: graph.direct_prerequisites(&topic_id),
        ancestors: graph.prerequisite_ancestors(&topic_id),
        topic,
    })
}

/// 下载某个学科的知识点包。
///
/// 上游只发布全量 `topics.json` 和 `dependencies.json`，所以这里下的是全量，
/// 下完在本地按 id 前缀切出这个学科，写进插件目录的 `packs/`。
/// 一次下载能满足所有学科，之后点别的学科直接读缓存。
#[tauri::command]
pub async fn download_plugin_knowledge_pack(
    app: AppHandle,
    state: State<'_, DbState>,
    plugin_id: String,
    subject: String,
) -> Result<KnowledgePack, String> {
    let subject = subject.trim().to_string();
    if !is_safe_subject(&subject) {
        return Err("学科代号不合法".into());
    }
    let dir = plugins_dir(&app)?;
    let packs = load_packs(&dir, &plugin_id)?;
    let pack = packs
        .find(&subject)
        .cloned()
        .ok_or_else(|| format!("学科包里没有 {subject}"))?;
    let prefixes = packs.prefixes_of(&subject);
    if prefixes.is_empty() {
        return Err(format!("学科 {subject} 没有知识点编号规则"));
    }

    let options = with_db(&state, |conn| knowledge_download_options(conn, &plugin_id))?;
    let topics_file = packs
        .files
        .get("topics")
        .cloned()
        .ok_or_else(|| "学科包清单缺少知识点数据文件".to_string())?;
    let dependencies_file = packs
        .files
        .get("dependencies")
        .cloned()
        .ok_or_else(|| "学科包清单缺少先修关系数据文件".to_string())?;

    let target_dir = dir.join(plugin_id.trim()).join(KNOWLEDGE_PACKS_DIR);
    std::fs::create_dir_all(&target_dir).map_err(|err| format!("创建知识点缓存目录失败：{err}"))?;

    let emitter = app.clone();
    let context = DownloadContext {
        packs: &packs,
        source: options.source,
        token: options.token.as_deref(),
        subject: &subject,
    };
    let topics_raw = {
        let emitter = emitter.clone();
        fetch_source_file(
            &context,
            &target_dir,
            "topics",
            &topics_file,
            move |progress| {
                let _ = emitter.emit(KNOWLEDGE_PACK_DOWNLOAD_PROGRESS_EVENT, progress);
            },
        )
        .await?
    };
    let dependencies_raw = {
        let emitter = emitter.clone();
        fetch_source_file(
            &context,
            &target_dir,
            "dependencies",
            &dependencies_file,
            move |progress| {
                let _ = emitter.emit(KNOWLEDGE_PACK_DOWNLOAD_PROGRESS_EVENT, progress);
            },
        )
        .await?
    };

    let all_topics = parse_topics(&topics_raw)?;
    let all_dependencies = parse_dependencies(&dependencies_raw)?;
    let topics = slice_topics_by_prefix(&all_topics, &prefixes);
    if topics.is_empty() {
        return Err(format!("没有切出 {subject} 的知识点，数据可能变了"));
    }
    let dependencies = slice_dependencies_by_prefix(&all_dependencies, &topics, &prefixes);

    let target_dir = dir.join(plugin_id.trim()).join(KNOWLEDGE_PACKS_DIR);
    std::fs::create_dir_all(&target_dir).map_err(|err| format!("创建知识点缓存目录失败：{err}"))?;
    write_pack_files(
        &target_dir,
        &subject,
        &KnowledgeTopicsFile {
            schema: 1,
            subject: pack.subject.clone(),
            subject_name: pack.name.clone(),
            source: packs.source.clone(),
            license: packs.license.clone(),
            generated_at: packs.generated_at.clone(),
            commit: packs.commit.clone(),
            count: topics.len(),
            topics: topics.clone(),
        },
        &KnowledgeDependenciesFile {
            schema: 1,
            subject: pack.subject.clone(),
            subject_name: pack.name.clone(),
            source: packs.source.clone(),
            license: packs.license.clone(),
            generated_at: packs.generated_at.clone(),
            commit: packs.commit.clone(),
            count: dependencies.len(),
            dependencies: dependencies.clone(),
        },
    )?;

    Ok(KnowledgePack {
        subject: pack.subject,
        name: pack.name,
        prefix: pack.prefix,
        count: topics.len(),
    })
}

/// 读内置的学科包清单。
fn load_packs(dir: &Path, plugin_id: &str) -> Result<KnowledgePacks, String> {
    let raw = plugin_resource_text(dir, plugin_id, KNOWLEDGE_PACKS_RESOURCE)?;
    parse_packs(&raw)
}

/// 读某个学科的图谱。
///
/// 先看下载缓存，没有再看内置资源。两个来源都是同一个 JSON 结构。
fn load_graph(dir: &Path, plugin_id: &str, subject: &str) -> Result<KnowledgeGraph, String> {
    if !is_safe_subject(subject) {
        return Err("学科代号不合法".into());
    }
    let (topics_path, dependencies_path) = pack_cache_paths(dir, plugin_id, subject);

    let (topics_raw, dependencies_raw) = if topics_path.is_file() && dependencies_path.is_file() {
        (
            read_file(&topics_path)?,
            read_file(&dependencies_path)?,
        )
    } else {
        (
            plugin_resource_text(dir, plugin_id, &format!("topics.{subject}.json"))?,
            plugin_resource_text(dir, plugin_id, &format!("dependencies.{subject}.json"))?,
        )
    };

    let topics = parse_topics(&topics_raw)?;
    let dependencies = parse_dependencies(&dependencies_raw)?;
    Ok(KnowledgeGraph::new(topics, dependencies))
}

/// 这个学科是不是已经下载到本地了。
///
/// 知识点文件和先修边文件是一套，缺一个都算没下载全——清单不能显示成「已下载」，
/// 否则用户点进去才发现先修关系是空的。
pub fn downloaded_pack_exists(dir: &Path, plugin_id: &str, subject: &str) -> bool {
    let (topics_path, dependencies_path) = pack_cache_paths(dir, plugin_id, subject);
    topics_path.is_file() && dependencies_path.is_file()
}

/// 学科包缓存里两个文件的位置。
fn pack_cache_paths(dir: &Path, plugin_id: &str, subject: &str) -> (PathBuf, PathBuf) {
    let cache_dir = dir.join(plugin_id.trim()).join(KNOWLEDGE_PACKS_DIR);
    (
        cache_dir.join(format!("topics.{subject}.json")),
        cache_dir.join(format!("dependencies.{subject}.json")),
    )
}

/// 下载选项：通道和选填的访问令牌。
struct KnowledgeDownloadOptions {
    source: DownloadSource,
    token: Option<String>,
}

fn knowledge_download_options(
    conn: &rusqlite::Connection,
    plugin_id: &str,
) -> Result<KnowledgeDownloadOptions, String> {
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
    Ok(KnowledgeDownloadOptions { source, token })
}

/// 一次学科包下载的上下文。
struct DownloadContext<'a> {
    /// 学科包清单：仓库名、commit、原始文件地址都在这里。
    packs: &'a KnowledgePacks,
    /// 下载通道。
    source: DownloadSource,
    /// 选填的访问令牌。
    token: Option<&'a str>,
    /// 当前下载的学科，只用于进度事件。
    subject: &'a str,
}

/// 取一个上游数据文件：本地有原始缓存就用缓存，没有就下载并缓存。
///
/// 上游只发布全量文件，一次下载就能切出所有学科，所以原始文件缓存一份就够，
/// 之后点别的学科直接切本地副本，不再重复下载 4MB 出头的内容。
async fn fetch_source_file(
    context: &DownloadContext<'_>,
    cache_dir: &Path,
    kind: &str,
    file: &crate::knowledge_graph::KnowledgeSourceFile,
    on_progress: impl FnMut(KnowledgeDownloadProgress),
) -> Result<String, String> {
    let path = raw_cache_path(cache_dir, kind, &file.sha);
    if path.is_file() {
        if let Ok(text) = std::fs::read_to_string(&path) {
            return Ok(text);
        }
    }
    let text = download_json_file(context, file, on_progress).await?;
    write_raw_file(&path, &text)?;
    Ok(text)
}

/// 原始数据缓存的文件路径。文件名里带 sha，数据更新后自然换一份缓存。
fn raw_cache_path(cache_dir: &Path, kind: &str, sha: &str) -> PathBuf {
    let sha = sha.trim();
    let name = if sha.is_empty() {
        format!("{kind}.json")
    } else {
        format!("{kind}.{sha}.json")
    };
    cache_dir.join(KNOWLEDGE_RAW_DIR).join(name)
}

/// 写原始数据缓存。先写 .tmp 再改名，避免半截文件被当成完整数据。
fn write_raw_file(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("创建原始数据缓存目录失败：{err}"))?;
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text).map_err(|err| format!("写入原始数据缓存失败：{err}"))?;
    std::fs::rename(&temp, path).map_err(|err| format!("保存原始数据缓存失败：{err}"))?;
    Ok(())
}

/// 下一个 JSON 数据文件。
///
/// 首选源按插件选项，另一个源留作备用。两个源指向同一个 commit 下的
/// 同一份文件，字节一样，断了换源接着下也不会拿到不同内容。
async fn download_json_file(
    context: &DownloadContext<'_>,
    file: &crate::knowledge_graph::KnowledgeSourceFile,
    mut on_progress: impl FnMut(KnowledgeDownloadProgress),
) -> Result<String, String> {
    let packs = context.packs;
    let source = context.source;
    let token = context.token;
    let subject = context.subject;
    let repo = packs.repo.trim();
    if repo.is_empty() {
        return Err("学科包清单缺少仓库名".into());
    }
    let sha = file.sha.trim();
    let blob_url = if sha.is_empty() {
        None
    } else {
        Some(format!("https://api.github.com/repos/{repo}/git/blobs/{sha}"))
    };
    let raw_url = {
        let base = packs.raw_base.trim().trim_end_matches('/');
        let commit = packs.commit.trim();
        if base.is_empty() || commit.is_empty() {
            None
        } else {
            Some(format!("{base}/{commit}/{}", encode_repo_path(&file.path)))
        }
    };

    let mut candidates: Vec<(String, DownloadSource)> = Vec::new();
    match source {
        DownloadSource::Blob => {
            candidates.extend(blob_url.clone().map(|url| (url, DownloadSource::Blob)));
            candidates.extend(raw_url.clone().map(|url| (url, DownloadSource::Raw)));
        }
        DownloadSource::Raw => {
            candidates.extend(raw_url.clone().map(|url| (url, DownloadSource::Raw)));
            candidates.extend(blob_url.clone().map(|url| (url, DownloadSource::Blob)));
        }
    }
    if candidates.is_empty() {
        return Err(format!("{} 没有下载地址", file.path));
    }

    let client = reqwest::Client::builder()
        .user_agent("TimeQuest")
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(120))
        .build()
        .map_err(|err| format!("创建下载客户端失败：{err}"))?;

    let total = file.size;
    let mut last_error = "下载失败".to_string();
    for attempt in 1..=3u32 {
        let (url, channel) = &candidates[(attempt as usize - 1) % candidates.len()];
        let mut builder = client.get(url);
        if *channel == DownloadSource::Blob {
            builder = builder.header("Accept", GITHUB_BLOB_ACCEPT);
            if let Some(token) = token.map(str::trim).filter(|token| !token.is_empty()) {
                builder = builder.header("Authorization", format!("Bearer {token}"));
            }
        }
        match builder.send().await {
            Ok(mut response) => {
                let status = response.status();
                if !status.is_success() {
                    last_error = download_error_message(*channel, status);
                    continue;
                }
                // blob 接口碰到大文件会改回 JSON，那不是我们要的内容。
                if let Some(content_type) = response.headers().get(reqwest::header::CONTENT_TYPE) {
                    let content_type = content_type.to_str().unwrap_or_default();
                    if content_type.contains("json") && !url.ends_with(".json") {
                        last_error = "服务端返回的是 JSON，不是文件内容".to_string();
                        continue;
                    }
                }
                let total_bytes = response.content_length().unwrap_or(total);
                let mut downloaded: u64 = 0;
                let mut body = Vec::new();
                let mut failed = false;
                loop {
                    match response.chunk().await {
                        Ok(Some(chunk)) => {
                            downloaded += chunk.len() as u64;
                            body.extend_from_slice(&chunk);
                            on_progress(KnowledgeDownloadProgress {
                                subject: subject.to_string(),
                                file: file.path.clone(),
                                downloaded,
                                total: total_bytes,
                            });
                        }
                        Ok(None) => break,
                        Err(err) => {
                            last_error = format!("下载中断：{err}");
                            failed = true;
                            break;
                        }
                    }
                }
                if failed {
                    continue;
                }
                let text = String::from_utf8(body)
                    .map_err(|_| "下载到的内容不是文本".to_string())?;
                // 顺手验一下是完整 JSON，别把半截文件写进缓存。
                serde_json::from_str::<serde_json::Value>(&text)
                    .map_err(|err| format!("下载到的数据不是完整 JSON：{err}"))?;
                return Ok(text);
            }
            Err(err) => {
                last_error = format!("下载失败：{err}");
            }
        }
    }
    Err(last_error)
}

/// 学科代号只允许小写字母、数字、下划线和横线，用来拼缓存文件名。
fn is_safe_subject(subject: &str) -> bool {
    !subject.is_empty()
        && subject
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '-')
}

/// 读一个文本文件。
fn read_file(path: &PathBuf) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|err| format!("读取知识点缓存失败：{err}"))
}

/// 写一个学科包的两个缓存文件。
///
/// 两个文件是一套：先都写进 `.tmp`，再依次改名。先修边先落盘，知识点文件
/// 最后落盘——清单里的「已下载」以知识点文件为准，它在就说明两个文件都齐了。
fn write_pack_files(
    dir: &Path,
    subject: &str,
    topics: &KnowledgeTopicsFile,
    dependencies: &KnowledgeDependenciesFile,
) -> Result<(), String> {
    let topics_text = serde_json::to_string_pretty(topics).map_err(|err| err.to_string())?;
    let dependencies_text =
        serde_json::to_string_pretty(dependencies).map_err(|err| err.to_string())?;

    let topics_temp = dir.join(format!("topics.{subject}.json.tmp"));
    let dependencies_temp = dir.join(format!("dependencies.{subject}.json.tmp"));
    write_temp_file(&dependencies_temp, &dependencies_text)?;
    if let Err(err) = write_temp_file(&topics_temp, &topics_text) {
        let _ = std::fs::remove_file(&dependencies_temp);
        return Err(err);
    }

    std::fs::rename(&dependencies_temp, dir.join(format!("dependencies.{subject}.json")))
        .map_err(|err| format!("保存知识点缓存失败：{err}"))?;
    std::fs::rename(&topics_temp, dir.join(format!("topics.{subject}.json")))
        .map_err(|err| format!("保存知识点缓存失败：{err}"))?;
    Ok(())
}

/// 写一个临时文件。写坏了就把半截文件收掉，不留在缓存目录里。
fn write_temp_file(path: &Path, text: &str) -> Result<(), String> {
    if let Err(err) = std::fs::write(path, text) {
        let _ = std::fs::remove_file(path);
        return Err(format!("写入知识点缓存失败：{err}"));
    }
    Ok(())
}

/// 排期冲突类型：同一个任务里，先修考点排在了后面。
pub const CONFLICT_ORDER_SWAPPED: &str = "order_swapped";

/// 排期冲突类型：先修考点在另一个任务里，那边还没学完。
pub const CONFLICT_PREREQUISITE_TASK_INCOMPLETE: &str = "prerequisite_task_incomplete";

/// 一条排期建议：先修还没学完就排了后面。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrerequisiteConflict {
    /// 冲突类型，见 `CONFLICT_ORDER_SWAPPED` / `CONFLICT_PREREQUISITE_TASK_INCOMPLETE`。
    pub kind: String,
    /// 出问题的那场：依赖先修的那个考点。
    pub topic_id: String,
    pub topic_name: String,
    /// 先修考点。
    pub prerequisite_id: String,
    pub prerequisite_name: String,
    /// 先修边强度。这里只报硬门槛，恒为 `hard`。
    pub strength: String,
    /// 先修考点在哪个任务里。同任务内顺序颠倒时就是当前任务。
    pub prerequisite_task_id: Option<i64>,
    pub prerequisite_task_title: Option<String>,
    /// 先修任务还差多少单元。学完了就没有。
    pub prerequisite_task_remaining: Option<i64>,
    /// 本任务第一场还没上的日期。
    pub dependent_session_date: Option<String>,
    /// 先修任务第一场还没上的日期。
    pub prerequisite_session_date: Option<String>,
    /// 一句人话，前端直接显示。
    pub message: String,
}

/// 库里的一条图谱考点。
#[derive(Debug, Clone, sqlx::FromRow)]
struct GraphPointRow {
    id: i64,
    task_id: i64,
    topic_id: String,
    /// 图谱学科代号。图谱考点一定有，自写 / 教材考点没有。
    subject: String,
    name: String,
    position: i64,
}

/// 任务的本轮进度和下一场排期。
#[derive(Debug, Clone, sqlx::FromRow)]
struct TaskProgressRow {
    task_id: i64,
    title: String,
    total_units: Option<i64>,
    /// 本轮实际完成量。
    round_units: i64,
    /// 第一场还没上的日期。没有待学场次就是空。
    next_session_date: Option<String>,
}

/// 检查一个任务的排期顺序有没有踩到先修门槛。
///
/// 纯读：不动任何表。只把「先修还没学完就排了后面」的情况列出来。
#[tauri::command]
pub async fn list_task_prerequisite_conflicts(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    task_id: i64,
    plugin_id: String,
) -> Result<Vec<PrerequisiteConflict>, String> {
    let dir = plugins_dir(&app)?;
    list_task_prerequisite_conflicts_impl(pool.inner(), &dir, &plugin_id, task_id).await
}

/// 排期检查的主体。
///
/// 判定口径：
/// - 先修考点也在当前任务里，但排位靠后 → `order_swapped`。
/// - 先修考点在别的任务里，那边没学完，而且本任务先开课 → `prerequisite_task_incomplete`。
///
/// 只报硬门槛。软边是「会了有帮助」，报出来只会刷屏。
pub async fn list_task_prerequisite_conflicts_impl(
    db: &SqlitePool,
    graph_dir: &Path,
    plugin_id: &str,
    task_id: i64,
) -> Result<Vec<PrerequisiteConflict>, String> {
    // 全库图谱考点。先修考点可能挂在别的任务上，所以一次取全。
    let points = sqlx::query_as::<_, GraphPointRow>(
        "SELECT id, task_id, graph_topic_id AS topic_id, COALESCE(graph_subject, '') AS subject,
                name, position
         FROM task_knowledge_points
         WHERE graph_topic_id IS NOT NULL AND TRIM(graph_topic_id) <> ''
         ORDER BY task_id ASC, position ASC, id ASC",
    )
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    let own: Vec<&GraphPointRow> = points.iter().filter(|row| row.task_id == task_id).collect();
    if own.is_empty() {
        return Ok(Vec::new());
    }

    // 图谱考点 id → 拥有它的考点行。同一个图谱考点可能被多个任务收着。
    let mut owners: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, row) in points.iter().enumerate() {
        owners.entry(row.topic_id.clone()).or_default().push(index);
    }

    let progresses = task_progress_rows(db).await?;
    let own_next_date = progresses
        .get(&task_id)
        .and_then(|progress| progress.next_session_date.clone());

    // 每个学科只读一次图谱。读不到就跳过这个学科，不让建议整体失败。
    let mut graphs: HashMap<String, KnowledgeGraph> = HashMap::new();
    for subject in own
        .iter()
        .map(|row| row.subject.as_str())
        .filter(|subject| !subject.is_empty())
    {
        if graphs.contains_key(subject) {
            continue;
        }
        if let Ok(graph) = load_graph(graph_dir, plugin_id, subject) {
            graphs.insert(subject.to_string(), graph);
        }
    }

    let mut conflicts: Vec<PrerequisiteConflict> = Vec::new();
    for row in &own {
        let Some(graph) = graphs.get(&row.subject) else {
            continue;
        };
        // 上游数据变了、这个 id 不在了，跳过这一个考点。
        if graph.topic(&row.topic_id).is_none() {
            continue;
        }
        for node in graph.direct_prerequisites(&row.topic_id) {
            if node.strength != STRENGTH_HARD {
                continue;
            }
            if let Some(conflict) = same_task_conflict(
                row,
                &node,
                &points,
                &owners,
                &progresses,
                task_id,
                own_next_date.as_deref(),
            ) {
                conflicts.push(conflict);
                continue;
            }
            if let Some(conflict) = other_task_conflict(
                row,
                &node,
                &points,
                &owners,
                &progresses,
                task_id,
                own_next_date.as_deref(),
            ) {
                conflicts.push(conflict);
            }
        }
    }
    Ok(conflicts)
}

/// 错题库里挂在某个图谱知识点上的一条错题。
#[derive(Debug, Clone, sqlx::FromRow)]
struct TopicMistakeRow {
    id: i64,
    subject: String,
    title: String,
    reason: String,
    correct_note: String,
    is_mastered: i64,
    created_at: String,
}

/// 查某个知识点上错过哪些题。
///
/// 纯读：不动任何表。错题本和知识图谱共用同一套知识点 id，这里就是那条缝——
/// 在图谱上看到「我在这里错过」，就知道错题本记的是同一件事，而不是另一张图。
///
/// 图谱读不到时知识点名留空，错题照样返回：不能因为缺一个学科包就把
/// 学生已经记下的错题藏起来。
#[tauri::command]
pub async fn list_topic_mistakes(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    plugin_id: String,
    subject: String,
    topic_id: String,
) -> Result<TopicMistakes, String> {
    let dir = plugins_dir(&app)?;
    list_topic_mistakes_impl(pool.inner(), &dir, &plugin_id, &subject, &topic_id).await
}

/// 查某个知识点上错过哪些题的主体。
pub async fn list_topic_mistakes_impl(
    db: &SqlitePool,
    graph_dir: &Path,
    plugin_id: &str,
    subject: &str,
    topic_id: &str,
) -> Result<TopicMistakes, String> {
    let topic_id = topic_id.trim();
    if topic_id.is_empty() {
        return Ok(TopicMistakes {
            topic_id: String::new(),
            topic_name: String::new(),
            total: 0,
            pending: 0,
            items: Vec::new(),
        });
    }

    let rows = sqlx::query_as::<_, TopicMistakeRow>(
        "SELECT id, subject, title, reason, correct_note, is_mastered, created_at
         FROM mistakes
         WHERE graph_topic_id = ?1
         ORDER BY is_mastered ASC, created_at DESC, id DESC",
    )
    .bind(topic_id)
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;

    let items: Vec<TopicMistake> = rows
        .into_iter()
        .map(|row| TopicMistake {
            id: row.id,
            subject: row.subject,
            title: row.title,
            reason: row.reason,
            correct_note: row.correct_note,
            is_mastered: row.is_mastered,
            created_at: row.created_at,
        })
        .collect();
    let pending = items.iter().filter(|item| item.is_mastered != 1).count() as i64;

    // 图谱读不到就只留空名字，错题照样给出来。
    let topic_name = load_graph(graph_dir, plugin_id, subject.trim())
        .ok()
        .and_then(|graph| graph.topic(topic_id).map(|topic| topic.name.clone()))
        .unwrap_or_default();

    Ok(TopicMistakes {
        topic_id: topic_id.to_string(),
        topic_name,
        total: items.len() as i64,
        pending,
        items,
    })
}

/// 同一个任务里：先修考点也在这儿，但排位比当前考点靠后。
fn same_task_conflict(
    row: &GraphPointRow,
    node: &PrerequisiteNode,
    points: &[GraphPointRow],
    owners: &HashMap<String, Vec<usize>>,
    progresses: &HashMap<i64, TaskProgressRow>,
    task_id: i64,
    own_next_date: Option<&str>,
) -> Option<PrerequisiteConflict> {
    let prerequisite = owners
        .get(&node.topic.id)?
        .iter()
        .map(|index| &points[*index])
        .find(|owner| owner.task_id == task_id)?;
    // 排位比当前考点靠前就是对的，不报。
    if (prerequisite.position, prerequisite.id) <= (row.position, row.id) {
        return None;
    }
    let task_title = progresses.get(&task_id).map(|p| p.title.clone());
    Some(PrerequisiteConflict {
        kind: CONFLICT_ORDER_SWAPPED.to_string(),
        topic_id: row.topic_id.clone(),
        topic_name: row.name.clone(),
        prerequisite_id: node.topic.id.clone(),
        prerequisite_name: node.topic.name.clone(),
        strength: node.strength.clone(),
        prerequisite_task_id: Some(task_id),
        prerequisite_task_title: task_title,
        prerequisite_task_remaining: None,
        dependent_session_date: own_next_date.map(str::to_string),
        prerequisite_session_date: None,
        message: format!(
            "「{}」要先会「{}」，但「{}」排在这个考点后面了。",
            row.name, node.topic.name, node.topic.name
        ),
    })
}

/// 先修考点在别的任务里：那边还没学完，而本任务已经先开课。
fn other_task_conflict(
    row: &GraphPointRow,
    node: &PrerequisiteNode,
    points: &[GraphPointRow],
    owners: &HashMap<String, Vec<usize>>,
    progresses: &HashMap<i64, TaskProgressRow>,
    task_id: i64,
    own_next_date: Option<&str>,
) -> Option<PrerequisiteConflict> {
    let candidates: Vec<&GraphPointRow> = owners
        .get(&node.topic.id)
        .map(|list| list.iter().map(|index| &points[*index]).collect())
        .unwrap_or_default();
    if candidates.is_empty() {
        // 先修压根没排进任何任务。那是「还没排」，不是「排后面」。
        return None;
    }
    // 本任务没有待学场次，就没有「这边先开课」这回事。
    let own_date = own_next_date?;

    // 同一个图谱考点可能被几个任务收着，挑还没学完的那个。
    let mut picked: Option<&TaskProgressRow> = None;
    for candidate in candidates {
        if candidate.task_id == task_id {
            continue;
        }
        let Some(progress) = progresses.get(&candidate.task_id) else {
            continue;
        };
        let Some(total) = progress.total_units else {
            continue;
        };
        // 副本任务没有「按单元推进」的概念，进度口径对不上，不报。
        if total <= 0 {
            continue;
        }
        // 已经学完了就没事了。
        if progress.round_units >= total {
            continue;
        }
        // 先修任务没排场次，就谈不上「排了后面」。
        let Some(prerequisite_date) = progress.next_session_date.as_deref() else {
            continue;
        };
        // 本任务比先修任务先开课，顺序反了。
        if own_date > prerequisite_date {
            continue;
        }
        picked = Some(progress);
        break;
    }

    let progress = picked?;
    let remaining = progress.total_units.unwrap_or(0) - progress.round_units;
    Some(PrerequisiteConflict {
        kind: CONFLICT_PREREQUISITE_TASK_INCOMPLETE.to_string(),
        topic_id: row.topic_id.clone(),
        topic_name: row.name.clone(),
        prerequisite_id: node.topic.id.clone(),
        prerequisite_name: node.topic.name.clone(),
        strength: node.strength.clone(),
        prerequisite_task_id: Some(progress.task_id),
        prerequisite_task_title: Some(progress.title.clone()),
        prerequisite_task_remaining: Some(remaining),
        dependent_session_date: Some(own_date.to_string()),
        prerequisite_session_date: progress.next_session_date.clone(),
        message: format!(
            "「{}」要先会「{}」，「{}」还在《{}》里没学完（还差 {} 课），而这个任务 {} 就开课。",
            row.name,
            node.topic.name,
            node.topic.name,
            progress.title,
            remaining,
            short_date(own_date)
        ),
    })
}

/// 读所有任务的本轮进度和下一场排期。
async fn task_progress_rows(db: &SqlitePool) -> Result<HashMap<i64, TaskProgressRow>, String> {
    let rows = sqlx::query_as::<_, TaskProgressRow>(
        "SELECT t.id AS task_id,
                t.title AS title,
                t.total_units AS total_units,
                COALESCE(SUM(CASE WHEN s.round = t.current_round THEN s.actual_units ELSE 0 END), 0)
                    AS round_units,
                MIN(CASE WHEN s.status = 'planned' THEN s.date END) AS next_session_date
         FROM tasks t
         LEFT JOIN task_sessions s ON s.task_id = t.id
         WHERE t.deleted_at IS NULL
         GROUP BY t.id",
    )
    .fetch_all(db)
    .await
    .map_err(|err| err.to_string())?;
    Ok(rows.into_iter().map(|row| (row.task_id, row)).collect())
}

/// `2026-11-20` → `11月20日`。给提示文案用。
fn short_date(date: &str) -> String {
    let date = date.trim();
    // `YYYY-MM-DD`：月是第二段，日是第三段。
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() < 3 {
        return date.to_string();
    }
    let month = parts[1].trim().parse::<u32>().unwrap_or(0);
    let day = parts[2].trim().parse::<u32>().unwrap_or(0);
    if month == 0 || day == 0 {
        return date.to_string();
    }
    format!("{month}月{day}日")
}
