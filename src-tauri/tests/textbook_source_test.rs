//! 教材源插件：清单解析、下载地址拼装、PDF 目录入库。
//!
//! 清单是插件自带的离线快照，描述了可下载的教材。下载地址有两种拼法：
//! blob 源走 GitHub 的 blob 接口（地址里只有 sha），raw 源走
//! `raw_base` + `commit` + 路径。分片书按 `<书名>.pdf_merge_folder/`
//! 里的顺序接回一个 PDF。

use std::path::PathBuf;
use timequest_lib::{
    download_error_message, encode_repo_path, extract_outline, outline_to_textbook,
    parse_textbook_catalog, plugin_resource_text, safe_file_name, textbook_download_requests,
    textbook_download_urls, DownloadSource,
};

const PLUGIN_ID: &str = "china-textbook";

/// 读插件自带的教材清单（插件没装也能读到内置的那份）。
fn builtin_catalog_text() -> String {
    let empty = std::env::temp_dir().join("timequest-no-plugins-installed");
    plugin_resource_text(&empty, PLUGIN_ID, "catalog.json").expect("builtin catalog")
}

fn builtin_catalog() -> timequest_lib::TextbookCatalog {
    parse_textbook_catalog(&builtin_catalog_text()).expect("parse catalog")
}

#[test]
fn builtin_catalog_lists_textbooks_with_dimensions() {
    let catalog = builtin_catalog();

    assert!(!catalog.commit.is_empty(), "清单要锁定仓库提交");
    assert!(
        catalog.raw_base.starts_with("https://"),
        "下载地址要用 https"
    );
    assert!(
        catalog.count == catalog.textbooks.len(),
        "清单里写的条数要对得上：{} vs {}",
        catalog.count,
        catalog.textbooks.len()
    );
    assert!(
        catalog.count > 1000,
        "教材库不该只有几本：{}",
        catalog.count
    );

    for book in &catalog.textbooks {
        assert!(book.path.ends_with(".pdf"), "路径要指向 PDF：{}", book.path);
        assert!(!book.title.is_empty());
        assert!(!book.subject.is_empty());
        assert!(!book.stage_key.is_empty());
        assert!(book.parts >= 1, "分片数至少为 1");
        assert!(book.size > 0, "大小要写进清单：{}", book.path);
    }
}

#[test]
fn builtin_catalog_keeps_sharded_books() {
    let catalog = builtin_catalog();
    let sharded: Vec<_> = catalog
        .textbooks
        .iter()
        .filter(|book| book.parts > 1)
        .collect();

    assert!(!sharded.is_empty(), "大书在仓库里是分片的，清单要标出来");
    for book in &sharded {
        assert!(book.parts >= 2);
        assert!(
            book.size > 10_000_000,
            "分片书都是大文件：{} 只有 {} 字节",
            book.path,
            book.size
        );
    }
}

#[test]
fn builtin_catalog_normalizes_stage() {
    let catalog = builtin_catalog();

    for book in &catalog.textbooks {
        assert!(
            ["小学", "初中", "高中", "大学", "其他"].contains(&book.stage_key.as_str()),
            "学段要归一化：{} -> {}",
            book.stage,
            book.stage_key
        );
    }
    // 五•四学制的书要并回主学段，而不是自成一类。
    let five_four: Vec<_> = catalog
        .textbooks
        .iter()
        .filter(|book| book.stage.contains("五•四学制"))
        .collect();
    assert!(!five_four.is_empty(), "清单里该有五•四学制的书");
    for book in five_four {
        let main = book.stage.replace("（五•四学制）", "");
        assert_eq!(book.stage_key, main, "五•四学制要并回主学段");
    }
}

#[test]
fn catalog_rejects_incomplete_payload() {
    let complete = |raw_base: &str, commit: &str, repo: &str| {
        format!(
            r#"{{"source":"x","repo":"{repo}","rawBase":"{raw_base}","commit":"{commit}","generatedAt":"2026-01-01","count":0,"stages":[],"textbooks":[]}}"#
        )
    };

    let error = parse_textbook_catalog(&complete("https://example.test", "", "o/r"))
        .expect_err("must fail");
    assert!(error.contains("提交"), "报错要说清缺什么：{error}");

    let error = parse_textbook_catalog(&complete("", "abc", "o/r")).expect_err("must fail");
    assert!(error.contains("下载地址"), "报错要说清缺什么：{error}");

    let error = parse_textbook_catalog(&complete("https://example.test", "abc", ""))
        .expect_err("must fail");
    assert!(error.contains("仓库名"), "报错要说清缺什么：{error}");

    let error = parse_textbook_catalog("not json").expect_err("must fail");
    assert!(error.contains("解析失败"), "坏 JSON 要报解析失败：{error}");
}

#[test]
fn catalog_rejects_shard_count_mismatch() {
    let raw = r#"{
        "source":"x","repo":"o/r","rawBase":"https://example.test","commit":"abc",
        "generatedAt":"2026-01-01","count":1,"stages":[],
        "textbooks":[{
            "path":"a/b.pdf","title":"b","stage":"初中","stageKey":"初中","subject":"数学",
            "edition":null,"grade":null,"size":10,"parts":2,
            "shards":[{"index":1,"size":10,"sha":"sha1"}]
        }]
    }"#;

    let error = parse_textbook_catalog(raw).expect_err("must fail");
    assert!(error.contains("分片"), "报错要说清是分片的问题：{error}");
}

#[test]
fn download_url_for_whole_book_encodes_the_path() {
    let urls = textbook_download_urls(
        "https://raw.githubusercontent.com/TapXWorld/ChinaTextbook",
        "abc123",
        "初中/数学/人教版-人民教育出版社/七年级/义务教育教科书·数学七年级上册.pdf",
        1,
    )
    .expect("url");

    assert_eq!(urls.len(), 1);
    let url = &urls[0];
    assert!(url.starts_with("https://raw.githubusercontent.com/TapXWorld/ChinaTextbook/abc123/"));
    assert!(!url.contains('中'), "中文路径要百分号编码：{url}");
    assert!(url.contains("%E4%B8%AD"), "编码后的中文路径：{url}");
    // 目录分隔符要保留，不能整段编码掉。
    assert!(url.contains("/%E6%95%B0%E5%AD%A6/"), "斜杠保留：{url}");
}

#[test]
fn download_url_for_sharded_book_lists_parts_in_order() {
    let path = "初中/体育与健康/华中师大版-华中师范大学出版社/七年级/义务教育教科书·体育与健康七年级全一册.pdf";
    let urls = textbook_download_urls("https://example.test/repo", "sha", path, 2).expect("url");

    assert_eq!(urls.len(), 2, "两个分片两个地址");
    let first = &urls[0];
    let second = &urls[1];
    assert!(
        first.contains(".pdf_merge_folder/"),
        "分片放在 merge 目录：{first}"
    );
    assert!(first.contains(".pdf.1"), "第一片：{first}");
    assert!(second.contains(".pdf.2"), "第二片：{second}");
    assert!(first < second, "分片顺序要对：{first} 应该在 {second} 前面");
}

#[test]
fn download_url_rejects_empty_input() {
    assert!(textbook_download_urls("", "sha", "a.pdf", 1).is_err());
    assert!(textbook_download_urls("https://example.test", "", "a.pdf", 1).is_err());
    assert!(textbook_download_urls("https://example.test", "sha", "  ", 1).is_err());
}

#[test]
fn repo_path_encoding_keeps_slashes_and_safe_characters() {
    assert_eq!(encode_repo_path("a/b/c.pdf"), "a/b/c.pdf");
    assert_eq!(
        encode_repo_path("人教版/x.pdf"),
        "%E4%BA%BA%E6%95%99%E7%89%88/x.pdf"
    );
    assert_eq!(encode_repo_path("a b.pdf"), "a%20b.pdf");
}

#[test]
fn safe_file_name_drops_illegal_characters() {
    assert_eq!(safe_file_name("数学/七年级"), "数学 七年级");
    assert_eq!(safe_file_name("a:b*c?d"), "a b c d");
    assert_eq!(safe_file_name("   "), "textbook");
    assert!(
        safe_file_name(&"长".repeat(300)).chars().count() <= 120,
        "文件名要截短，不然 Windows 路径会超限"
    );
}

#[test]
fn pdf_outline_becomes_a_textbook_with_numbered_sections() {
    let chapters = extract_outline(include_bytes!("fixtures/toc_layout.pdf")).expect("parse toc");
    let outline = outline_to_textbook(&chapters, "数学", "人教版", "七年级上册").expect("outline");

    assert_eq!(outline.subject, "数学");
    assert_eq!(outline.version, "人教版");
    assert_eq!(outline.volume, "七年级上册");
    assert_eq!(outline.chapters.len(), 3);
    assert_eq!(outline.chapters[0].name, "第一章 有理数");

    let first = &outline.chapters[0].sections[0];
    assert_eq!(first.name, "1.1 正数和负数");
    assert!(
        first.knowledge_points.is_empty(),
        "目录里没有知识点，得让学生自己补"
    );
}

#[test]
fn outline_without_any_section_is_rejected() {
    let error = outline_to_textbook(&[], "数学", "人教版", "七年级上册").expect_err("must fail");
    assert!(error.contains("目录"), "报错要说清是目录的问题：{error}");
}

#[test]
fn textbooks_dir_is_scoped_by_plugin() {
    let root = std::env::temp_dir().join(format!("timequest-textbooks-{}", uuid::Uuid::new_v4()));
    let dir = timequest_lib::textbooks_dir(&root, "china-textbook").expect("dir");

    assert!(dir.ends_with(PathBuf::from("textbooks").join("china-textbook")));
    assert!(dir.is_dir(), "目录要建出来");

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn textbooks_dir_rejects_bad_plugin_id() {
    let root = std::env::temp_dir().join(format!("timequest-textbooks-{}", uuid::Uuid::new_v4()));
    for bad in ["", "  ", "../escape", "a/b"] {
        assert!(
            timequest_lib::textbooks_dir(&root, bad).is_err(),
            "插件 id {bad:?} 不能拿来拼路径"
        );
    }
    let _ = std::fs::remove_dir_all(&root);
}

/// 一本分两片的书，用来验证两种下载源的地址拼法。
fn sharded_fixture() -> (
    timequest_lib::TextbookCatalog,
    timequest_lib::CatalogTextbook,
) {
    let raw = r#"{
        "source":"https://github.com/TapXWorld/ChinaTextbook",
        "repo":"TapXWorld/ChinaTextbook",
        "rawBase":"https://raw.githubusercontent.com/TapXWorld/ChinaTextbook",
        "commit":"abc123","generatedAt":"2026-01-01","count":1,"stages":[],
        "textbooks":[{
            "path":"初中/数学/人教版/义务教育教科书·数学七年级上册.pdf",
            "title":"义务教育教科书·数学七年级上册","stage":"初中","stageKey":"初中",
            "subject":"数学","edition":"人教版","grade":"七年级","size":30,"parts":2,
            "shards":[
                {"index":1,"size":10,"sha":"sha-one"},
                {"index":2,"size":20,"sha":"sha-two"}
            ]
        }]
    }"#;
    let catalog = parse_textbook_catalog(raw).expect("parse catalog");
    let book = catalog.textbooks[0].clone();
    (catalog, book)
}

#[test]
fn blob_requests_use_the_blob_api_and_keep_shard_order() {
    let (catalog, book) = sharded_fixture();

    let requests =
        textbook_download_requests(&catalog, &book, DownloadSource::Blob).expect("requests");

    assert_eq!(requests.len(), 2, "两个分片两个地址");
    assert_eq!(
        requests[0].url,
        "https://api.github.com/repos/TapXWorld/ChinaTextbook/git/blobs/sha-one"
    );
    assert_eq!(
        requests[1].url,
        "https://api.github.com/repos/TapXWorld/ChinaTextbook/git/blobs/sha-two"
    );
    assert_eq!(requests[0].index, 1);
    assert_eq!(requests[1].index, 2);
    assert!(
        requests.iter().all(|request| request.url.is_ascii()),
        "blob 地址里不该有中文"
    );
}

#[test]
fn raw_requests_fall_back_to_the_raw_paths() {
    let (catalog, book) = sharded_fixture();

    let requests =
        textbook_download_requests(&catalog, &book, DownloadSource::Raw).expect("requests");

    assert_eq!(requests.len(), 2);
    assert!(requests[0]
        .url
        .starts_with("https://raw.githubusercontent.com/TapXWorld/ChinaTextbook/abc123/"));
    assert!(
        requests[0].url.contains(".pdf_merge_folder/"),
        "分片目录：{}",
        requests[0].url
    );
    assert!(
        requests[1].url.ends_with(".pdf.2"),
        "第二片：{}",
        requests[1].url
    );
}

#[test]
fn download_source_parses_plugin_option_values() {
    assert_eq!(DownloadSource::parse("blob"), DownloadSource::Blob);
    assert_eq!(DownloadSource::parse("RAW"), DownloadSource::Raw);
    assert_eq!(DownloadSource::parse(" raw "), DownloadSource::Raw);
    assert_eq!(
        DownloadSource::parse("看不懂的值"),
        DownloadSource::Blob,
        "认不出来的值回落到默认的 blob"
    );
    assert_eq!(DownloadSource::Blob.as_str(), "blob");
    assert_eq!(DownloadSource::Raw.as_str(), "raw");
}

#[test]
fn blob_requests_reject_a_shard_without_sha() {
    let (catalog, mut book) = sharded_fixture();
    book.shards[1].sha = String::new();

    let error =
        textbook_download_requests(&catalog, &book, DownloadSource::Blob).expect_err("must fail");
    assert!(error.contains("sha"), "报错要说清缺什么：{error}");
}

#[test]
fn rate_limit_message_points_to_the_channel_not_to_signing_up() {
    let message = download_error_message(DownloadSource::Blob, reqwest::StatusCode::FORBIDDEN);

    assert!(message.contains("下载通道"), "要告诉学生换通道：{message}");
    assert!(
        message.contains("不用注册账号"),
        "换通道不需要 GitHub 账号，别让学生以为必须注册：{message}"
    );
    assert!(
        message.contains("访问令牌"),
        "令牌是可选的提额手段，也要点明：{message}"
    );
    assert!(
        !message.contains("GitHub token"),
        "界面上不出现技术黑话：{message}"
    );
}

#[test]
fn missing_file_and_server_errors_keep_their_own_wording() {
    let missing =
        download_error_message(DownloadSource::Blob, reqwest::StatusCode::NOT_FOUND);
    assert!(missing.contains("找不到"), "文件没了要说清：{missing}");
    assert!(
        !missing.contains("下载次数"),
        "限额提示不该混进找不到文件的场景：{missing}"
    );

    let broken = download_error_message(DownloadSource::Blob, reqwest::StatusCode::INTERNAL_SERVER_ERROR);
    assert!(
        broken.contains("服务器返回"),
        "其它状态码照实说：{broken}"
    );
    assert!(
        !broken.contains("下载次数"),
        "限额提示只属于 403：{broken}"
    );
}
