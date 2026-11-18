//! 教材下载：分片按顺序接成一个 PDF，断了能续传，失败不留半成品。
//!
//! 用本机的一个最小 HTTP 服务代替 GitHub，验的是「下载 → 续传 → 拼接 → 落盘」
//! 这条路径本身，不依赖外网。

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};

use timequest_lib::{
    download_textbook, parse_textbook_catalog, textbook_download_plan, CatalogShard,
    CatalogTextbook, DownloadCandidate, DownloadProgress, DownloadRetryPolicy, DownloadShardPlan,
    DownloadSource, TextbookCatalog,
};

/// 服务端的一次回应。
#[derive(Clone)]
struct Reply {
    status: u16,
    body: Vec<u8>,
    /// 只发这么多字节就把连接掐断，模拟传到一半断线。
    cut: Option<usize>,
    /// 要不要认 `Range` 请求：认就回 206 + 剩下的字节。
    honor_range: bool,
}

impl Reply {
    /// 正常回应，认 `Range`。
    fn ok(body: Vec<u8>) -> Self {
        Self {
            status: 200,
            body,
            cut: None,
            honor_range: true,
        }
    }

    /// 指定状态码的回应，不认 `Range`。
    fn status(status: u16, body: Vec<u8>) -> Self {
        Self {
            status,
            body,
            cut: None,
            honor_range: false,
        }
    }

    /// 发一半就掐断连接。
    fn cut_after(body: Vec<u8>, cut: usize) -> Self {
        Self {
            status: 200,
            body,
            cut: Some(cut),
            honor_range: true,
        }
    }

    /// 整本重发，不认 `Range`。
    fn ignore_range(body: Vec<u8>) -> Self {
        Self {
            status: 200,
            body,
            cut: None,
            honor_range: false,
        }
    }
}

/// 起一个最小 HTTP 服务：每次连接回一段内容。
///
/// 回应按顺序用，用完了重复最后一段，这样「第一次断、第二次成」能测。
///
/// 第三个返回值是服务端收到的请求头，用来验客户端有没有真的带 `Range`。
fn spawn_server(
    replies: Vec<Reply>,
) -> (String, std::thread::JoinHandle<()>, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let heads: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let heads_for_thread = heads.clone();
    let handle = std::thread::spawn(move || {
        let mut used = 0usize;
        loop {
            let Ok((mut stream, _)) = listener.accept() else {
                break;
            };
            let Some(reply) = replies.get(used).or_else(|| replies.last()).cloned() else {
                break;
            };
            used += 1;
            let mut buffer = [0u8; 4096];
            let _ = stream.read(&mut buffer);
            let head = String::from_utf8_lossy(&buffer).to_string();
            heads_for_thread.lock().expect("heads").push(head.clone());
            respond(&mut stream, &reply, parse_range(&head));
        }
    });
    (format!("http://127.0.0.1:{port}"), handle, heads)
}

/// 按约定回一次响应。
fn respond(stream: &mut std::net::TcpStream, reply: &Reply, range: Option<u64>) {
    let mut status = reply.status;
    let mut payload = reply.body.clone();
    let mut content_range = String::new();
    if reply.honor_range {
        if let Some(offset) = range {
            let offset = offset as usize;
            if offset >= payload.len() {
                status = 416;
                payload.clear();
            } else {
                let total = reply.body.len();
                status = 206;
                content_range = format!(
                    "Content-Range: bytes {}-{}/{}\r\n",
                    offset,
                    total - 1,
                    total
                );
                payload = reply.body[offset..].to_vec();
            }
        }
    }
    // 掐断时 Content-Length 仍报完整长度，客户端才会发现消息不完整。
    let declared = payload.len();
    let send = match reply.cut {
        Some(cut) => cut.min(declared),
        None => declared,
    };
    let reason = match status {
        200 => "OK",
        206 => "Partial Content",
        416 => "Range Not Satisfiable",
        _ => "Error",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Length: {declared}\r\nContent-Type: application/pdf\r\n{content_range}Connection: close\r\n\r\n"
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&payload[..send]);
    let _ = stream.flush();
    // 出了函数 stream 就被关掉：掐断的那次客户端会读到不完整的消息。
}

/// 从请求头里取 `Range: bytes=N-` 的起点。
fn parse_range(head: &str) -> Option<u64> {
    let lowered = head.to_ascii_lowercase();
    let marker = "range: bytes=";
    let at = lowered.find(marker)? + marker.len();
    let rest = &head[at..];
    let end = rest.find('-')?;
    rest[..end].trim().parse().ok()
}

/// 测试用的重试策略：不歇，重试次数跟正式逻辑一样。
fn fast_policy() -> DownloadRetryPolicy {
    DownloadRetryPolicy {
        max_attempts: 8,
        delay_ms: 0,
    }
}

/// 造一份清单。
fn catalog_for(base: &str, sizes: &[u64]) -> TextbookCatalog {
    let parts = sizes.len() as u32;
    let total: u64 = sizes.iter().sum();
    let shards: Vec<String> = sizes
        .iter()
        .enumerate()
        .map(|(position, size)| {
            format!(
                r#"{{"index":{},"size":{size},"sha":"sha-{}"}}"#,
                position + 1,
                position + 1
            )
        })
        .collect();
    let raw = format!(
        r#"{{
            "source":"https://example.test","repo":"o/r","rawBase":"{base}","commit":"sha",
            "generatedAt":"2026-01-01","count":1,"stages":[],
            "textbooks":[{{
                "path":"初中/数学/人教版/义务教育教科书·数学七年级上册.pdf",
                "title":"义务教育教科书·数学七年级上册",
                "stage":"初中","stageKey":"初中","subject":"数学",
                "edition":"人教版-人民教育出版社","grade":"七年级",
                "size":{total},"parts":{parts},"shards":[{}]
            }}]
        }}"#,
        shards.join(",")
    );
    parse_textbook_catalog(&raw).expect("catalog")
}

/// 造一本书。
fn book_for(size: u64, parts: u32) -> CatalogTextbook {
    CatalogTextbook {
        path: "初中/数学/人教版/义务教育教科书·数学七年级上册.pdf".into(),
        title: "义务教育教科书·数学七年级上册".into(),
        stage: "初中".into(),
        stage_key: "初中".into(),
        subject: "数学".into(),
        edition: Some("人教版-人民教育出版社".into()),
        grade: Some("七年级".into()),
        size,
        parts,
        shards: vec![CatalogShard {
            index: 1,
            size,
            sha: "sha-1".into(),
        }],
    }
}

/// 造一个只指向本机服务的下载计划。
fn plan_for(base: &str, sizes: &[u64]) -> Vec<DownloadShardPlan> {
    sizes
        .iter()
        .enumerate()
        .map(|(position, size)| DownloadShardPlan {
            index: position as u32 + 1,
            size: *size,
            candidates: vec![DownloadCandidate {
                url: format!("{base}/part-{}", position + 1),
                source: DownloadSource::Raw,
            }],
        })
        .collect()
}

/// 造一段像 PDF 的内容。
fn fake_pdf(bytes: usize) -> Vec<u8> {
    let mut body = b"%PDF-1.7 ".to_vec();
    while body.len() < bytes {
        body.extend_from_slice(b"timequest-textbook-bytes ");
    }
    body.truncate(bytes);
    body
}

fn scratch_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "timequest-download-{label}-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).expect("scratch dir");
    dir
}

/// 目录里剩下的文件名。
fn files_in(dir: &PathBuf) -> Vec<String> {
    std::fs::read_dir(dir)
        .expect("read dir")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect()
}

#[tokio::test]
async fn sharded_book_joins_parts_into_one_pdf() {
    let first = b"%PDF-1.7 first part".to_vec();
    let second = b" and the second part".to_vec();
    let total = (first.len() + second.len()) as u64;
    let (base, _server, _heads) = spawn_server(vec![Reply::ok(first.clone()), Reply::ok(second.clone())]);

    let book = book_for(total, 2);
    let plan = plan_for(&base, &[first.len() as u64, second.len() as u64]);
    assert_eq!(plan.len(), 2, "两片两个计划");

    let dir = scratch_dir("join");
    let (tx, rx) = mpsc::channel();
    let result = download_textbook(
        &dir,
        &book,
        &plan,
        None,
        fast_policy(),
        move |progress: DownloadProgress| {
            let _ = tx.send(progress);
        },
    )
    .await
    .expect("download");

    let mut joined = first.clone();
    joined.extend_from_slice(&second);
    assert_eq!(
        std::fs::read(&result.file).expect("read"),
        joined,
        "两片要按顺序接成一个文件"
    );
    assert_eq!(result.bytes, total, "写下的字节数要对得上");

    let progress: Vec<DownloadProgress> = rx.iter().collect();
    assert!(!progress.is_empty(), "下载过程要报进度");
    let last = progress.last().expect("last progress");
    assert_eq!(last.downloaded, total, "进度是累计字节数");
    assert_eq!(last.parts, 2);
    assert_eq!(last.part, 2, "最后落在第 2 片上");
    assert_eq!(last.path, book.path, "进度要对得上是哪本书");
    assert_eq!(last.total, total, "总量取自清单");
    assert_eq!(last.attempt, 1, "一次传完不用重试");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn whole_book_downloads_to_a_single_file() {
    let body = b"%PDF-1.7 whole book".to_vec();
    let total = body.len() as u64;
    let (base, _server, _heads) = spawn_server(vec![Reply::ok(body.clone())]);

    let book = book_for(total, 1);
    let plan = plan_for(&base, &[total]);

    let dir = scratch_dir("whole");
    let result = download_textbook(&dir, &book, &plan, None, fast_policy(), |_| {})
        .await
        .expect("download");

    assert_eq!(std::fs::read(&result.file).expect("read"), body);
    assert!(
        result.file.ends_with(".pdf"),
        "落盘的是 PDF：{}",
        result.file
    );
    assert!(
        !result.file.ends_with(".part"),
        "下完要改名，不能留着半成品：{}",
        result.file
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn failed_download_leaves_no_partial_file() {
    let (base, _server, _heads) = spawn_server(vec![Reply::status(500, b"boom".to_vec())]);

    let book = book_for(4, 1);
    let plan = plan_for(&base, &[4]);

    let dir = scratch_dir("failed");
    let error = download_textbook(&dir, &book, &plan, None, fast_policy(), |_| {})
        .await
        .expect_err("must fail");

    assert!(error.contains("500"), "报错要带状态码：{error}");
    let left = files_in(&dir);
    assert!(left.is_empty(), "失败不能留下 .part 或半截 PDF：{left:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn download_without_requests_is_rejected() {
    let book = book_for(4, 1);
    let dir = scratch_dir("empty");

    let error = download_textbook(&dir, &book, &[], None, fast_policy(), |_| {})
        .await
        .expect_err("must fail");

    assert!(error.contains("没有下载地址"), "报错要说清缺什么：{error}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn interrupted_download_resumes_from_where_it_stopped() {
    let body = fake_pdf(2000);
    // 第一次传到 700 字节就被掐断，第二次认 `Range` 接着传。
    let (base, _server, heads) = spawn_server(vec![
        Reply::cut_after(body.clone(), 700),
        Reply::ok(body.clone()),
    ]);

    let book = book_for(body.len() as u64, 1);
    let plan = plan_for(&base, &[body.len() as u64]);

    let dir = scratch_dir("resume");
    let (tx, rx) = mpsc::channel();
    let result = download_textbook(
        &dir,
        &book,
        &plan,
        None,
        fast_policy(),
        move |progress: DownloadProgress| {
            let _ = tx.send(progress);
        },
    )
    .await
    .expect("断了要能续传下完");

    assert_eq!(
        std::fs::read(&result.file).expect("read"),
        body,
        "续传后要拿到完整的文件，不能多也不能少"
    );

    let progress: Vec<DownloadProgress> = rx.iter().collect();
    assert!(
        progress.iter().any(|item| item.attempt >= 2),
        "断了要重试：{progress:?}"
    );
    assert_eq!(
        progress.last().expect("last").attempt,
        2,
        "第二次尝试才传完"
    );

    // 第二次请求要真的带上 `Range`，不然就是从头重下。
    let requests = heads.lock().expect("heads").clone();
    assert!(
        requests.len() >= 2,
        "应该发过两次请求：{requests:?}"
    );
    assert!(
        !requests[0].to_ascii_lowercase().contains("range:"),
        "第一次不用带 `Range`：{}",
        requests[0]
    );
    assert!(
        requests[1].to_ascii_lowercase().contains("range: bytes=700-"),
        "第二次要接着已收的 700 字节传：{}",
        requests[1]
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn server_ignoring_range_restarts_the_shard() {
    let body = fake_pdf(2000);
    // 第二次无视 `Range`，整本重发。
    let (base, _server, _heads) = spawn_server(vec![
        Reply::cut_after(body.clone(), 700),
        Reply::ignore_range(body.clone()),
    ]);

    let book = book_for(body.len() as u64, 1);
    let plan = plan_for(&base, &[body.len() as u64]);

    let dir = scratch_dir("ignore-range");
    let result = download_textbook(&dir, &book, &plan, None, fast_policy(), |_| {})
        .await
        .expect("要能从头重下这一片");

    assert_eq!(
        std::fs::read(&result.file).expect("read"),
        body,
        "服务端不给续传时要从头重下，不能拼出重复字节"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn size_mismatch_is_reported_and_nothing_is_left() {
    let body = b"short".to_vec();
    let (base, _server, _heads) = spawn_server(vec![Reply::ok(body.clone())]);

    // 清单说 100 字节，服务端只给 5 字节。
    let book = book_for(100, 1);
    let plan = plan_for(&base, &[100]);

    let dir = scratch_dir("mismatch");
    let error = download_textbook(&dir, &book, &plan, None, fast_policy(), |_| {})
        .await
        .expect_err("must fail");

    assert!(error.contains("大小对不上"), "报要说清哪里对不上：{error}");
    assert!(error.contains("100"), "要带上清单里的大小：{error}");
    assert!(error.contains("5"), "要带上实际收到的大小：{error}");
    let left = files_in(&dir);
    assert!(left.is_empty(), "失败不能留下半截文件：{left:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn plan_carries_both_sources() {
    let catalog = catalog_for("http://127.0.0.1:1", &[4]);
    let book = &catalog.textbooks[0];

    let blob_first = textbook_download_plan(&catalog, book, DownloadSource::Blob).expect("plan");
    assert_eq!(blob_first.len(), 1);
    assert_eq!(blob_first[0].candidates.len(), 2, "首选源加备用源");
    assert_eq!(blob_first[0].candidates[0].source, DownloadSource::Blob);
    assert_eq!(blob_first[0].candidates[1].source, DownloadSource::Raw);
    assert!(
        blob_first[0].candidates[0]
            .url
            .starts_with("https://api.github.com/repos/o/r/git/blobs/"),
        "blob 地址要带 sha：{}",
        blob_first[0].candidates[0].url
    );
    assert!(
        blob_first[0].candidates[1]
            .url
            .starts_with("http://127.0.0.1:1/"),
        "备用源走 raw 地址：{}",
        blob_first[0].candidates[1].url
    );

    let raw_first = textbook_download_plan(&catalog, book, DownloadSource::Raw).expect("plan");
    assert_eq!(raw_first[0].candidates[0].source, DownloadSource::Raw);
    assert_eq!(raw_first[0].candidates[1].source, DownloadSource::Blob);
}
