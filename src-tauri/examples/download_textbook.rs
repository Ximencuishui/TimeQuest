//! 下载一本教材，验证清单里的地址真的能取到文件。
//!
//! 用法：
//!   cargo run --example download_textbook -- <清单路径> [--index N | --smallest | --sharded] [--ranged] [--parse] [--report <文件>]
//!
//! 选书只能用序号或开关（命令行传中文容易被终端编码坑）。
//! `--ranged` 只取每个分片的头 1KB，用来快速验证地址对不对，不落整本书。
//! `--report` 把报告写成 UTF-8 文件，绕开终端的编码问题。

use std::path::PathBuf;

use timequest_lib::{
    download_textbook, extract_outline, extract_outline_lines, parse_textbook_catalog,
    textbook_download_plan, CatalogTextbook, DownloadRetryPolicy, DownloadSource,
};

/// 报告内容。加 `--report` 时写进文件，否则打到标准输出。
struct Report {
    lines: Vec<String>,
    path: Option<PathBuf>,
}

impl Report {
    fn line(&mut self, text: impl Into<String>) {
        self.lines.push(text.into());
    }

    fn flush(&self) -> Result<(), String> {
        let body = self.lines.join("\n");
        match &self.path {
            Some(path) => std::fs::write(path, body).map_err(|err| err.to_string()),
            None => {
                println!("{body}");
                Ok(())
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let ranged = args.iter().any(|arg| arg == "--ranged");
    let has_flag = |name: &str| args.iter().any(|arg| arg == name);
    let positional: Vec<&String> = args.iter().filter(|arg| !arg.starts_with("--")).collect();
    let report_path = args
        .iter()
        .position(|arg| arg == "--report")
        .and_then(|at| args.get(at + 1))
        .map(PathBuf::from);
    let mut report = Report {
        lines: Vec::new(),
        path: report_path,
    };

    // --local 直接解析本地已有的 PDF，不再下载。
    if let Some(at) = args.iter().position(|arg| arg == "--local") {
        let local = args.get(at + 1).ok_or("--local 要一个文件路径")?.clone();
        let bytes = std::fs::read(&local).map_err(|err| err.to_string())?;
        describe(&mut report, &bytes);
        report.flush()?;
        return Ok(());
    }

    // --local-dir 取目录下最大的 PDF。命令行传中文路径容易被终端编码坑。
    if let Some(at) = args.iter().position(|arg| arg == "--local-dir") {
        let dir = args.get(at + 1).ok_or("--local-dir 要一个目录")?.clone();
        let mut files: Vec<(std::path::PathBuf, u64)> = std::fs::read_dir(&dir)
            .map_err(|err| err.to_string())?
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .map(|ext| ext.eq_ignore_ascii_case("pdf"))
                    .unwrap_or(false)
            })
            .filter_map(|entry| {
                let size = entry.metadata().ok()?.len();
                Some((entry.path(), size))
            })
            .collect();
        files.sort_by_key(|(_, size)| *size);
        let path = files
            .last()
            .map(|(path, _)| path.clone())
            .ok_or("目录里没有 PDF")?;
        report.line(format!("本地文件: {}", path.display()));
        let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
        describe(&mut report, &bytes);
        report.flush()?;
        return Ok(());
    }

    if positional.len() < 2 {
        eprintln!("用法: download_textbook <清单路径> [--index N | --smallest | --sharded] [--ranged] [--parse] [--report <文件>]");
        std::process::exit(1);
    }
    let catalog_path: PathBuf = positional[1].as_str().into();

    let raw = std::fs::read_to_string(&catalog_path).map_err(|err| err.to_string())?;
    let catalog = parse_textbook_catalog(&raw)?;

    let book = if let Some(index) = args.iter().position(|arg| arg == "--index") {
        let raw_index = args.get(index + 1).ok_or("缺少 --index 的参数")?;
        let index: usize = raw_index.parse().map_err(|_| "--index 要一个数字")?;
        catalog
            .textbooks
            .get(index)
            .ok_or_else(|| format!("清单里没有第 {index} 本"))?
            .clone()
    } else if has_flag("--smallest") {
        catalog
            .textbooks
            .iter()
            .min_by_key(|book| book.size)
            .ok_or("清单是空的")?
            .clone()
    } else if has_flag("--sharded") {
        catalog
            .textbooks
            .iter()
            .filter(|book| book.parts > 1)
            .min_by_key(|book| book.size)
            .ok_or("清单里没有分片书")?
            .clone()
    } else {
        let path = positional
            .get(2)
            .ok_or("要用 --index / --smallest / --sharded 选一本")?;
        catalog
            .find(path)
            .ok_or_else(|| format!("清单里没有 {path}"))?
            .clone()
    };

    report.line(format!("教材: {}", book.title));
    report.line(format!("路径: {}", book.path));
    report.line(format!("分片: {}，清单大小 {} 字节", book.parts, book.size));

    let source = if has_flag("--raw") {
        DownloadSource::Raw
    } else {
        DownloadSource::Blob
    };
    let plan = textbook_download_plan(&catalog, &book, source)?;
    report.line(format!("下载源: {}", source.as_str()));
    for shard in &plan {
        for candidate in &shard.candidates {
            report.line(format!("地址（第 {} 片）：{}", shard.index, candidate.url));
        }
    }

    if ranged {
        report.flush()?;
        let urls: Vec<String> = plan
            .iter()
            .filter_map(|shard| shard.candidates.first().map(|c| c.url.clone()))
            .collect();
        return probe(urls).await;
    }

    let dir = std::env::temp_dir().join("timequest-download-check");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let mut last_report = 0u64;
    let mut last_attempt = 0u32;
    let result = download_textbook(
        &dir,
        &book,
        &plan,
        None,
        DownloadRetryPolicy::default(),
        |progress| {
            if progress.attempt != last_attempt {
                last_attempt = progress.attempt;
                report.line(format!(
                    "第 {} 次尝试，已传 {} 字节",
                    progress.attempt, progress.downloaded
                ));
            }
            if progress.downloaded - last_report >= 2_000_000 {
                last_report = progress.downloaded;
            }
        },
    )
    .await?;

    report.line(format!("下载完成: {} 字节", result.bytes));
    let on_disk = std::fs::metadata(&result.file)
        .map_err(|err| err.to_string())?
        .len();
    report.line(format!("落盘大小: {on_disk} 字节"));
    if book.size > 0 && on_disk != book.size {
        report.line(format!("注意：落盘大小与清单里的 {} 不一致", book.size));
    }

    if has_flag("--parse") {
        let bytes = std::fs::read(&result.file).map_err(|err| err.to_string())?;
        describe(&mut report, &bytes);
    }
    report.flush()?;
    Ok(())
}

/// 解析一份 PDF 的目录，并把目录页附近的页面写进报告。
fn describe(report: &mut Report, bytes: &[u8]) {
    dump_near_toc(report, bytes);
    match extract_outline_lines(bytes) {
        Ok(lines) => {
            report.line(format!("目录页原始行（{} 行）：", lines.len()));
            for line in &lines {
                report.line(format!("  |{line}"));
            }
        }
        Err(err) => report.line(format!("没找到目录页：{err}")),
    }
    match extract_outline(bytes) {
        Ok(chapters) => {
            report.line(format!("解析出 {} 章：", chapters.len()));
            for chapter in &chapters {
                report.line(format!(
                    "  {}（{} 小节）",
                    chapter.title,
                    chapter.sections.len()
                ));
            }
        }
        Err(err) => {
            report.line(format!("目录解析失败：{err}"));
            let pages = inspect_pages(bytes);
            report.line(format!("共 {} 页", pages.len()));
            for (number, text) in pages.iter().enumerate() {
                let head: String = text.chars().take(200).collect();
                report.line(format!("--- 第 {} 页 ---\n{}", number + 1, head));
            }
        }
    }
}

/// 每页抽一点文字出来，看这份 PDF 到底有没有文本层。
fn inspect_pages(bytes: &[u8]) -> Vec<String> {
    timequest_lib::inspect_pdf_pages(bytes).unwrap_or_default()
}

/// 把目录页前后几页的内容打出来，目录跨页时要看清楚。
fn dump_near_toc(report: &mut Report, bytes: &[u8]) {
    let pages = inspect_pages(bytes);
    let Some(index) = pages.iter().position(|text| {
        text.lines().any(|line| {
            line.chars()
                .filter(|c| !c.is_whitespace())
                .collect::<String>()
                == "目录"
        })
    }) else {
        report.line("没找到带「目录」标题的页");
        return;
    };
    report.line(format!("「目录」标题在第 {} 页", index + 1));
    for offset in 0..4usize {
        let at = index + offset;
        let Some(text) = pages.get(at) else { break };
        report.line(format!("--- 第 {} 页 ---", at + 1));
        for line in text.lines().take(40) {
            report.line(format!("  |{line}"));
        }
    }
}

/// 只取每个分片的头 1KB，确认地址有效。
async fn probe(urls: Vec<String>) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("TimeQuest")
        .build()
        .map_err(|err| err.to_string())?;
    for url in urls {
        let response = client
            .get(&url)
            .header("Accept", "application/vnd.github.raw")
            .header("Range", "bytes=0-1023")
            .send()
            .await
            .map_err(|err| format!("{url} 请求失败：{err}"))?;
        let status = response.status();
        let length = response.content_length().unwrap_or(0);
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let body = response.bytes().await.map_err(|err| err.to_string())?;
        println!(
            "  {status}，Content-Length {length}，实取 {} 字节，类型 {content_type}",
            body.len()
        );
        if !status.is_success() {
            return Err(format!("{url} 返回 {status}"));
        }
    }
    Ok(())
}

/// 让编译器知道 CatalogTextbook 被用到了（示例里只需要它的字段）。
#[allow(dead_code)]
fn _assert_type(_: &CatalogTextbook) {}
