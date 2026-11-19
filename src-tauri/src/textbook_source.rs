//! 教材源插件的清单解析与按需下载。
//!
//! 插件自带一份教材清单快照（资源文件，JSON），里面记着每本书的路径、
//! 学段、科目、版本、年级和大小。用户挑中哪本，才去下载哪本。
//!
//! 清单里的路径来自 GitHub 仓库树，下载地址由清单的 `raw_base` + `commit`
//! 拼出来。超过 GitHub 单文件 100MB 上限的书在仓库里是切成
//! `<书名>.pdf_merge_folder/<书名>.pdf.N` 的分片，这里按顺序把它们接回一个 PDF。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// 清单里某个学段的书本数量。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStage {
    pub label: String,
    pub count: usize,
}

/// 清单里的一个分片。
///
/// 一本书通常就是一个分片（完整 PDF）；超过 GitHub 单文件上限的会拆成几个。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogShard {
    /// 分片序号，从 1 开始。
    pub index: u32,
    /// 这个分片的字节数。
    pub size: u64,
    /// GitHub blob 的 sha，下载走 blob 接口时用它拼地址。
    pub sha: String,
}

/// 清单里的一本书。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogTextbook {
    /// 仓库里的相对路径，例如 `初中/数学/人教版-人民教育出版社/七年级/xxx.pdf`。
    pub path: String,
    pub title: String,
    /// 原始学段名，可能是 `小学（五•四学制）` 这种带括号的。
    pub stage: String,
    /// 归一化后的学段：`小学` / `初中` / `高中` / `大学` / `其他`。
    pub stage_key: String,
    pub subject: String,
    /// 教材版本，例如 `人教版-人民教育出版社`。
    pub edition: Option<String>,
    /// 年级册次，例如 `七年级`；有些书没有这一层。
    pub grade: Option<String>,
    /// 文件总字节数。
    pub size: u64,
    /// 分片数。`1` 表示仓库里就是完整的一个 PDF。
    pub parts: u32,
    /// 每个分片的信息，顺序就是拼装的顺序。
    pub shards: Vec<CatalogShard>,
}

/// 一份教材清单快照。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextbookCatalog {
    pub source: String,
    /// 仓库全名，形式 `owner/repo`，下载走 blob 接口时要用。
    pub repo: String,
    /// 原始文件下载前缀，例如 `https://raw.githubusercontent.com/TapXWorld/ChinaTextbook`。
    pub raw_base: String,
    /// 清单对应的仓库提交，下载时用它锁定内容。
    pub commit: String,
    pub generated_at: String,
    pub count: usize,
    pub stages: Vec<CatalogStage>,
    pub textbooks: Vec<CatalogTextbook>,
}

impl TextbookCatalog {
    /// 按路径找一本书；找不到返回 None。
    pub fn find(&self, path: &str) -> Option<&CatalogTextbook> {
        let path = path.trim();
        self.textbooks.iter().find(|book| book.path == path)
    }
}

/// 解析教材清单。字段缺失或类型不对都会报错，不静默跳过。
pub fn parse_textbook_catalog(raw: &str) -> Result<TextbookCatalog, String> {
    let catalog: TextbookCatalog =
        serde_json::from_str(raw).map_err(|err| format!("教材清单解析失败：{err}"))?;
    if catalog.raw_base.trim().is_empty() {
        return Err("教材清单缺少下载地址".into());
    }
    if catalog.commit.trim().is_empty() {
        return Err("教材清单缺少仓库提交号".into());
    }
    if catalog.repo.trim().is_empty() {
        return Err("教材清单缺少仓库名".into());
    }
    for book in &catalog.textbooks {
        if book.path.trim().is_empty() {
            return Err("教材清单里有空路径".into());
        }
        if book.parts == 0 {
            return Err(format!("教材 {} 的分片数不对", book.path));
        }
        if book.shards.len() != book.parts as usize {
            return Err(format!("教材 {} 的分片记录和分片数对不上", book.path));
        }
    }
    Ok(catalog)
}

/// 从哪里下载教材文件。
///
/// `Blob` 走 GitHub 的 blob 接口：地址里只有 sha，不受中文路径影响，
/// 但未认证时有每小时 60 次的限额。`Raw` 走 raw.githubusercontent：
/// 没有限额，但在部分网络环境下连得上却传不动。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadSource {
    Blob,
    Raw,
}

/// 走 blob 接口时，GitHub 要求带上这个 Accept 才会直接返回文件内容。
pub const GITHUB_BLOB_ACCEPT: &str = "application/vnd.github.raw";

impl DownloadSource {
    /// 从插件选项里读下载源；认不出来的值当默认的 blob。
    pub fn parse(value: &str) -> DownloadSource {
        match value.trim().to_ascii_lowercase().as_str() {
            "raw" => DownloadSource::Raw,
            _ => DownloadSource::Blob,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            DownloadSource::Blob => "blob",
            DownloadSource::Raw => "raw",
        }
    }
}

/// 一个要下载的地址。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadRequest {
    /// 完整地址。
    pub url: String,
    /// 分片序号，从 1 开始。
    pub index: u32,
}

/// 一个候选下载地址。
///
/// 同一个分片可以有多条路走：首选源不通就换另一个源。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadCandidate {
    /// 完整地址。
    pub url: String,
    /// 这个地址属于哪个源，决定请求怎么发。
    pub source: DownloadSource,
}

/// 一个分片的下载计划。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadShardPlan {
    /// 分片序号，从 1 开始。
    pub index: u32,
    /// 这个分片应该有多少字节；清单没写时是 0，表示不校验。
    pub size: u64,
    /// 候选地址，按顺序试；第一个是首选源。
    pub candidates: Vec<DownloadCandidate>,
}

/// 按下载源算出这本书要取的地址列表。
///
/// 分片书按 `1..=parts` 的顺序返回，调用方按顺序接起来就是完整 PDF。
pub fn textbook_download_requests(
    catalog: &TextbookCatalog,
    book: &CatalogTextbook,
    source: DownloadSource,
) -> Result<Vec<DownloadRequest>, String> {
    match source {
        DownloadSource::Blob => {
            let repo = catalog.repo.trim();
            if repo.is_empty() {
                return Err("教材清单缺少仓库名".into());
            }
            let mut requests = Vec::with_capacity(book.shards.len());
            for shard in &book.shards {
                let sha = shard.sha.trim();
                if sha.is_empty() {
                    return Err(format!(
                        "教材 {} 的分片 {} 没有 sha",
                        book.path, shard.index
                    ));
                }
                requests.push(DownloadRequest {
                    url: format!("https://api.github.com/repos/{repo}/git/blobs/{sha}"),
                    index: shard.index,
                });
            }
            Ok(requests)
        }
        DownloadSource::Raw => {
            let urls =
                textbook_download_urls(&catalog.raw_base, &catalog.commit, &book.path, book.parts)?;
            Ok(urls
                .into_iter()
                .enumerate()
                .map(|(index, url)| DownloadRequest {
                    url,
                    index: index as u32 + 1,
                })
                .collect())
        }
    }
}

/// 算出一本书的下载计划：每个分片一组候选地址。
///
/// 首选源按插件选项来，另一个源留作备用。两个源指向同一个 commit 下的
/// 同一份文件，字节完全一样，所以断了以后换源接着传也不会拼出坏文件。
///
/// 备用源拿不到时（比如清单没写下载地址）就只用首选源。
pub fn textbook_download_plan(
    catalog: &TextbookCatalog,
    book: &CatalogTextbook,
    primary: DownloadSource,
) -> Result<Vec<DownloadShardPlan>, String> {
    let repo = catalog.repo.trim();
    if repo.is_empty() {
        return Err("教材清单缺少仓库名".into());
    }
    let raw_urls =
        textbook_download_urls(&catalog.raw_base, &catalog.commit, &book.path, book.parts)
            .unwrap_or_default();
    let mut plans = Vec::with_capacity(book.shards.len());
    for (position, shard) in book.shards.iter().enumerate() {
        let sha = shard.sha.trim();
        let blob = (!sha.is_empty()).then(|| DownloadCandidate {
            url: format!("https://api.github.com/repos/{repo}/git/blobs/{sha}"),
            source: DownloadSource::Blob,
        });
        let raw = raw_urls.get(position).map(|url| DownloadCandidate {
            url: url.clone(),
            source: DownloadSource::Raw,
        });
        let mut candidates = Vec::with_capacity(2);
        match primary {
            DownloadSource::Blob => {
                candidates.extend(blob);
                candidates.extend(raw);
            }
            DownloadSource::Raw => {
                candidates.extend(raw);
                candidates.extend(blob);
            }
        }
        if candidates.is_empty() {
            return Err(format!(
                "教材 {} 的分片 {} 没有下载地址",
                book.path, shard.index
            ));
        }
        plans.push(DownloadShardPlan {
            index: shard.index,
            size: shard.size,
            candidates,
        });
    }
    Ok(plans)
}

/// 一本书要下载的地址列表（raw 源）。
///
/// 分片书按 `1..=parts` 的顺序返回，调用方按顺序接起来就是完整 PDF。
pub fn textbook_download_urls(
    raw_base: &str,
    commit: &str,
    path: &str,
    parts: u32,
) -> Result<Vec<String>, String> {
    let base = raw_base.trim().trim_end_matches('/');
    let commit = commit.trim();
    if base.is_empty() || commit.is_empty() {
        return Err("下载地址不完整".into());
    }
    let path = path.trim();
    if path.is_empty() {
        return Err("教材路径为空".into());
    }
    if parts <= 1 {
        return Ok(vec![format!("{base}/{commit}/{}", encode_repo_path(path))]);
    }

    let (dir, file_name) = match path.rsplit_once('/') {
        Some((dir, name)) => (dir, name),
        None => ("", path),
    };
    // 仓库里分片的文件名是 `<书名>.pdf.N`，书名本身不带 .pdf 后缀。
    let stem = file_name.strip_suffix(".pdf").unwrap_or(file_name);
    let mut urls = Vec::with_capacity(parts as usize);
    for index in 1..=parts {
        let part_path = format!("{dir}/{stem}.pdf_merge_folder/{stem}.pdf.{index}");
        urls.push(format!("{base}/{commit}/{}", encode_repo_path(&part_path)));
    }
    Ok(urls)
}

/// 仓库路径转成可放进 URL 的形式：逐段百分号编码，斜杠保留。
pub fn encode_repo_path(path: &str) -> String {
    path.split('/')
        .map(encode_segment)
        .collect::<Vec<_>>()
        .join("/")
}

fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// 下载进度：每收到一块就报一次。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    /// 清单里那本书的路径，用来对上是哪一本。
    pub path: String,
    /// 已经落盘的字节数（分片书是累计值）。
    pub downloaded: u64,
    /// 这本书的总字节数；清单没写时是 0，表示不知道。
    pub total: u64,
    /// 当前在第几个分片，从 1 开始。
    pub part: u32,
    /// 总分片数。
    pub parts: u32,
    /// 第几次尝试，从 1 开始；断了重传会变大于 1。
    pub attempt: u32,
}

/// 下载结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedTextbook {
    /// 落在磁盘上的完整 PDF 路径。
    pub file: String,
    /// 实际写下的字节数。
    pub bytes: u64,
}

/// 教材 PDF 的落盘目录：`appData/textbooks/<插件 id>`。
pub fn textbooks_dir(app_data_dir: &Path, plugin_id: &str) -> Result<PathBuf, String> {
    let plugin_id = plugin_id.trim();
    if plugin_id.is_empty()
        || !plugin_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("插件 id 不合法".into());
    }
    let dir = app_data_dir.join("textbooks").join(plugin_id);
    std::fs::create_dir_all(&dir).map_err(|err| format!("创建教材目录失败：{err}"))?;
    Ok(dir)
}

/// 一次下载最多试几次。
///
/// 教材动辄几十兆，慢网上一条连接常常传不到一半就断，
/// 所以要能断了接着传，而不是每次从头再来。
const MAX_DOWNLOAD_ATTEMPTS: usize = 8;

/// 两次尝试之间歇多久（毫秒），会随尝试次数慢慢加长。
const DOWNLOAD_RETRY_DELAY_MS: u64 = 700;

/// 下载重试策略。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DownloadRetryPolicy {
    /// 最多试几次（含第一次）。
    pub max_attempts: usize,
    /// 每次重试前歇多久（毫秒）；实际会随尝试次数加长。
    pub delay_ms: u64,
}

impl Default for DownloadRetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: MAX_DOWNLOAD_ATTEMPTS,
            delay_ms: DOWNLOAD_RETRY_DELAY_MS,
        }
    }
}

/// 下载一本书到 `dir`，返回落盘的 PDF 路径。
///
/// 分片书会按顺序把每一片接到同一个临时文件上，全部下完再改名，
/// 所以中途失败不会留下一个看起来完整的 PDF。
///
/// 传进来的是下载计划：每个分片有几条候选地址。下断了就用 `Range`
/// 接着传，换一条地址再试。两个源指向同一个 commit，字节一样，
/// 换源续传不会拼出坏文件。
pub async fn download_textbook(
    dir: &Path,
    book: &CatalogTextbook,
    plan: &[DownloadShardPlan],
    token: Option<&str>,
    policy: DownloadRetryPolicy,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<DownloadedTextbook, String> {
    if plan.is_empty() {
        return Err(format!("教材 {} 没有下载地址", book.path));
    }
    let file_name = format!("{}.pdf", safe_file_name(&book.title));
    let target = dir.join(&file_name);
    let temp = dir.join(format!("{file_name}.part"));

    let result = download_into(&temp, book, plan, token, policy, &mut on_progress).await;
    match result {
        Ok(bytes) => {
            tokio::fs::rename(&temp, &target)
                .await
                .map_err(|err| format!("保存教材失败：{err}"))?;
            Ok(DownloadedTextbook {
                file: target.to_string_lossy().to_string(),
                bytes,
            })
        }
        Err(err) => {
            // 失败不留半成品：下次再下从头开始，不会拿旧文件续传出错位。
            let _ = tokio::fs::remove_file(&temp).await;
            Err(err)
        }
    }
}

/// 真正下主体的函数：分片按顺序接进临时文件。
async fn download_into(
    temp: &Path,
    book: &CatalogTextbook,
    plan: &[DownloadShardPlan],
    token: Option<&str>,
    policy: DownloadRetryPolicy,
    on_progress: &mut impl FnMut(DownloadProgress),
) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .user_agent("TimeQuest")
        .connect_timeout(Duration::from_secs(30))
        // 不设整体超时：慢网上几十兆的教材要传很久，
        // 但一段时间一个字节都没来就是断了，这种要断开重连。
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|err| format!("创建下载客户端失败：{err}"))?;

    let mut file = tokio::fs::File::create(temp)
        .await
        .map_err(|err| format!("创建临时文件失败：{err}"))?;
    let mut downloaded: u64 = 0;

    for shard in plan {
        if shard.candidates.is_empty() {
            return Err(format!(
                "教材 {} 的分片 {} 没有下载地址",
                book.path, shard.index
            ));
        }
        // 这一片在文件里的起点。
        let shard_start = downloaded;
        // 这一片已经拿到多少字节。
        let mut shard_done: u64 = 0;
        let mut attempt: usize = 1;
        let mut candidate_index: usize = 0;
        let mut last_error = "下载中断".to_string();

        loop {
            if attempt > policy.max_attempts {
                return Err(format!(
                    "下载失败：{last_error}（已重试 {} 次）",
                    policy.max_attempts.saturating_sub(1)
                ));
            }
            let candidate = &shard.candidates[candidate_index % shard.candidates.len()];
            let mut builder = client.get(&candidate.url);
            if candidate.source == DownloadSource::Blob {
                builder = builder.header("Accept", GITHUB_BLOB_ACCEPT);
                if let Some(token) = token.map(str::trim).filter(|token| !token.is_empty()) {
                    builder = builder.header("Authorization", format!("Bearer {token}"));
                }
            }
            if shard_done > 0 {
                builder = builder.header("Range", format!("bytes={shard_done}-"));
            }

            let response = builder.send().await;
            let mut response = match response {
                Ok(response) => response,
                Err(err) => {
                    last_error = format!("下载失败：{}", describe_error(&err));
                    attempt += 1;
                    candidate_index += 1;
                    sleep_before_retry(attempt, policy.delay_ms).await;
                    continue;
                }
            };

            let status = response.status();
            if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
                // 服务端说这个位置往后没有内容了：只有正好下完才是对的。
                if shard.size > 0 && shard_done == shard.size {
                    break;
                }
                // 不接受就从头再来，别死磕同一个位置。
                last_error = "服务端不接受续传位置".to_string();
                truncate_to(&mut file, shard_start).await?;
                shard_done = 0;
                downloaded = shard_start;
                attempt += 1;
                candidate_index += 1;
                sleep_before_retry(attempt, policy.delay_ms).await;
                continue;
            }
            if !status.is_success() {
                last_error = download_error_message(candidate.source, status);
                attempt += 1;
                candidate_index += 1;
                sleep_before_retry(attempt, policy.delay_ms).await;
                continue;
            }
            // blob 接口碰到超大文件会改回 JSON，raw 才是文件本体。
            if let Some(content_type) = response.headers().get(reqwest::header::CONTENT_TYPE) {
                let content_type = content_type.to_str().unwrap_or_default();
                if content_type.contains("json") {
                    last_error = "服务端返回的是 JSON，不是文件内容".to_string();
                    attempt += 1;
                    candidate_index += 1;
                    sleep_before_retry(attempt, policy.delay_ms).await;
                    continue;
                }
            }

            let partial = status == reqwest::StatusCode::PARTIAL_CONTENT;
            if shard_done > 0 {
                // 要的是接着传，服务端却整本重发：这一片从头再来。
                let served_from = content_range_start(&response);
                if !partial || served_from.is_some_and(|start| start != shard_done) {
                    truncate_to(&mut file, shard_start).await?;
                    shard_done = 0;
                    downloaded = shard_start;
                }
            }

            // 失败分两种：连接断了（留着已收的字节，下次续传），
            // 和内容不可信（这一片要从头来）。
            let mut failure: Option<(String, bool)> = None;
            loop {
                match response.chunk().await {
                    Ok(Some(chunk)) => {
                        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
                            .await
                            .map_err(|err| format!("写入文件失败：{err}"))?;
                        shard_done += chunk.len() as u64;
                        downloaded = shard_start + shard_done;
                        on_progress(DownloadProgress {
                            path: book.path.clone(),
                            downloaded,
                            total: book.size,
                            part: shard.index,
                            parts: plan.len() as u32,
                            attempt: attempt as u32,
                        });
                    }
                    Ok(None) => break,
                    Err(err) => {
                        // 连接断了：已收的字节留着，下次带 `Range` 接着传。
                        failure = Some((
                            format!("下载中断：{}", describe_error(&err)),
                            true,
                        ));
                        break;
                    }
                }
            }

            if failure.is_none() {
                if shard.size > 0 && shard_done != shard.size {
                    // 长度对不上：这一片不可信，从头来。
                    failure = Some((
                        format!(
                            "分片大小对不上：清单说 {} 字节，实际收到 {} 字节",
                            shard.size, shard_done
                        ),
                        false,
                    ));
                } else {
                    break; // 这一片下完了
                }
            }
            let (reason, keep_partial) = failure.unwrap_or_default();
            if !keep_partial && shard_done > 0 {
                truncate_to(&mut file, shard_start).await?;
                shard_done = 0;
                downloaded = shard_start;
            }
            last_error = reason;
            attempt += 1;
            candidate_index += 1;
            sleep_before_retry(attempt, policy.delay_ms).await;
        }
    }

    tokio::io::AsyncWriteExt::flush(&mut file)
        .await
        .map_err(|err| format!("写入文件失败：{err}"))?;
    Ok(downloaded)
}

/// 把文件截回某个长度，并把写入位置也挪回去。
async fn truncate_to(file: &mut tokio::fs::File, length: u64) -> Result<(), String> {
    file.set_len(length)
        .await
        .map_err(|err| format!("回退文件长度失败：{err}"))?;
    tokio::io::AsyncSeekExt::seek(file, std::io::SeekFrom::Start(length))
        .await
        .map_err(|err| format!("回退文件位置失败：{err}"))?;
    Ok(())
}

/// 从 `Content-Range` 里取起始偏移。
fn content_range_start(response: &reqwest::Response) -> Option<u64> {
    let value = response.headers().get("content-range")?.to_str().ok()?;
    let rest = value.trim().strip_prefix("bytes ")?;
    let start = rest.split('-').next()?.trim();
    start.parse().ok()
}

/// 失败后等一会儿再试，别把服务器连着砸。
async fn sleep_before_retry(attempt: usize, delay_ms: u64) {
    let delay = delay_ms.saturating_mul(attempt as u64);
    tokio::time::sleep(Duration::from_millis(delay.min(3_000))).await;
}

/// 把错误连同它的底层原因一起说出来。
///
/// reqwest 把「连接断了」这类传输层错误统一显示成
/// "error decoding response body"，不看底层原因就分不清是超时还是被掐断。
fn describe_error(err: &dyn std::error::Error) -> String {
    let mut parts = vec![err.to_string()];
    let mut source = err.source();
    while let Some(inner) = source {
        let text = inner.to_string();
        if !text.is_empty() && !parts.iter().any(|part| part == &text) {
            parts.push(text);
        }
        source = inner.source();
    }
    parts.join(" → ")
}

/// 把 HTTP 状态码翻译成用户看得懂的中文提示。
///
/// blob 接口未认证时每小时只有 60 次额度，用完了会返回 403；
/// 这时候告诉用户「换个通道、过会儿再试，或者填个访问令牌提额」，
/// 比干巴巴一句「403」有用；也要说清换通道不用注册账号。
pub fn download_error_message(source: DownloadSource, status: reqwest::StatusCode) -> String {
    if source == DownloadSource::Blob && status == reqwest::StatusCode::FORBIDDEN {
        return "今天的下载次数用完了。换个下载通道通常就能继续（不用注册账号）；也可以过一会儿再试，或在「高级设置」里填一个访问令牌提高额度。".to_string();
    }
    if source == DownloadSource::Blob && status == reqwest::StatusCode::NOT_FOUND {
        return "GitHub 上找不到这个文件，清单可能过期了".to_string();
    }
    if source == DownloadSource::Raw && status == reqwest::StatusCode::NOT_FOUND {
        return "GitHub 上找不到这个文件，清单可能过期了".to_string();
    }
    format!("服务器返回 {status}")
}

/// 把书名变成能落盘的文件名：去掉路径分隔符和 Windows 不允许的字符。
pub fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| match ch {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            ch if (ch as u32) < 0x20 => ' ',
            ch => ch,
        })
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        return "textbook".to_string();
    }
    // 留出后缀空间，避免 Windows 的 260 字符路径上限被截断。
    let mut trimmed: String = cleaned.chars().take(120).collect();
    while trimmed.ends_with(' ') {
        trimmed.pop();
    }
    if trimmed.is_empty() {
        "textbook".to_string()
    } else {
        trimmed
    }
}
