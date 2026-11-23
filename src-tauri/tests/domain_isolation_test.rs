//! 内核零污染护栏。
//!
//! L0 内核（游戏化、排期、统计、场次）必须与赛道无关：
//! 它不认识「语文」「数学」，也不知道总分是 610 还是 750。
//! 一旦内核里出现这些常量，换赛道就会带着高考的假设跑偏。
//!
//! 这条测试直接扫源码，把领域常量挡在内核之外。
//!
//! 4.0 起护栏不再只盯四个文件：新增的共享层（`models.rs` 之类）最容易
//! 混进领域常量，漏掉它们等于没有护栏。所以改成**默认全量扫描**：
//! `src/` 下的每个 `.rs` 都受检，只有下面那份「领域适配层」名单豁免。
//! 名单之外的新文件自动进受检范围，不用每次改护栏。

use std::fs;
use std::path::{Path, PathBuf};

/// L0 内核模块清单。这些文件不参与赛道适配。
const CORE_MODULES: [&str; 4] = [
    "src/gamification.rs",
    "src/commands/planner.rs",
    "src/commands/stats.rs",
    "src/commands/sessions.rs",
];

/// 领域适配层：允许出现领域常量的文件。
///
/// 这些文件本来就负责把赛道翻译成具体的学科 / 教材 / 演示数据，
/// 出现学科名是应该的。名单之外一律不许出现。
///
/// 名单要求“严”：每一条都得真的含领域常量（由
/// `the_domain_adapter_list_is_not_a_blanket_exemption` 盯着），
/// 否则说明它已经可以回到受检范围。
const DOMAIN_ADAPTERS: [&str; 3] = [
    // 赛道字典：每条赛道播种自己的科目与目标。
    "src/commands/tracks.rs",
    // 演示数据：造一份带学科名的样例任务。
    "src/commands/mock.rs",
    // 教材目录：章节标题里带「数学活动」这类字样。
    "src/pdf_outline.rs",
];

/// 不允许出现在内核里的领域常量。
const DOMAIN_TOKENS: [&str; 8] = [
    "语文", "数学", "英语", "物理", "化学", "生物", "610", "750",
];

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read_module(relative: &str) -> String {
    let path = crate_root().join(relative);
    fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("读不到模块 {relative}：{error}");
    })
}

/// 去掉行注释，只留代码。
///
/// 护栏要拦的是代码里的领域常量。文档里的举例（「显示名，如「语文」」）
/// 不该把共享层（`models.rs` / `types.rs`）整个挡在受检范围外。
///
/// 块注释（`/* */`）的内容保留在扫描范围内：本仓库的代码风格不用块注释，
/// 真要用的话，把领域常量写进块注释也算越界。
fn strip_comments(source: &str) -> String {
    let mut kept: Vec<&str> = Vec::new();
    for line in source.lines() {
        if line.trim_start().starts_with("//") {
            continue;
        }
        kept.push(strip_trailing_comment(line));
    }
    kept.join("\n")
}

/// 去掉行尾注释。
///
/// `//` 前面引号数量为偶数时才算注释起点，免得把 `"https://…"` 里的
/// 斜杠当成注释，把后半行代码一起丢掉。
fn strip_trailing_comment(line: &str) -> &str {
    let mut quotes = 0usize;
    let mut escaped = false;
    let mut end = line.len();
    for (index, ch) in line.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            '"' => quotes += 1,
            '/' => {
                if line[index + 1..].starts_with('/') && quotes % 2 == 0 {
                    end = index;
                    break;
                }
            }
            _ => {}
        }
    }
    &line[..end]
}

/// 收齐 `src/` 下的所有 Rust 源文件，返回 (相对 crate 根的路径, 源码)。
///
/// 路径统一用 `src/xxx.rs` 的形式，和 `DOMAIN_ADAPTERS` / `CORE_MODULES`
/// 里的写法对得上。
fn rust_sources() -> Vec<(String, String)> {
    let base = crate_root();
    let root = base.join("src");
    let mut files: Vec<(String, String)> = Vec::new();
    collect_rs(&base, &root, &mut files);
    files.sort_by(|left, right| left.0.cmp(&right.0));
    files
}

fn collect_rs(base: &Path, dir: &Path, out: &mut Vec<(String, String)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rs(base, &path, out);
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
            continue;
        }
        let relative = path
            .strip_prefix(base)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let source = fs::read_to_string(&path).unwrap_or_default();
        out.push((relative, source));
    }
}

#[test]
fn core_modules_have_no_domain_constants() {
    for module in CORE_MODULES {
        let source = read_module(module);
        for token in DOMAIN_TOKENS {
            assert!(
                !source.contains(token),
                "内核模块 {module} 不该出现领域常量「{token}」。\
                 赛道相关内容请放到领域适配层（tracks/subjects/goals/exams）。"
            );
        }
    }
}

#[test]
fn core_modules_do_not_read_the_legacy_score_table() {
    // 成绩已经行化（exam_sessions / exam_scores），内核更不该碰旧的六列宽表。
    for module in CORE_MODULES {
        let source = read_module(module);
        assert!(
            !source.contains("exam_records"),
            "内核模块 {module} 不该再读旧成绩表 exam_records。"
        );
        assert!(
            !source.contains("subject_targets"),
            "内核模块 {module} 不该再读旧档案字段 subject_targets。"
        );
    }
}

#[test]
fn no_module_outside_the_domain_adapters_carries_domain_constants() {
    // 默认全量扫描：名单之外的新文件自动受检，不用每次改护栏。
    for (relative, source) in rust_sources() {
        if DOMAIN_ADAPTERS.contains(&relative.as_str()) {
            continue;
        }
        let code = strip_comments(&source);
        for token in DOMAIN_TOKENS {
            assert!(
                !code.contains(token),
                "{relative} 不该出现领域常量「{token}」。\
                 它既不是内核也不是领域适配层：赛道相关内容请放到 \
                 tracks/subjects/goals/exams 这些适配层文件里。"
            );
        }
    }
}

#[test]
fn the_domain_adapter_list_is_not_a_blanket_exemption() {
    // 白名单不许膨胀：名单里的文件得真的含领域常量，
    // 否则说明它其实可以回到受检范围。
    for adapter in DOMAIN_ADAPTERS {
        let source = strip_comments(&read_module(adapter));
        assert!(
            DOMAIN_TOKENS
                .iter()
                .any(|token| source.contains(token)),
            "{adapter} 列在领域适配层名单里，却一个领域常量都没有——\
             把它挪回受检范围吧。"
        );
    }
}

#[test]
fn the_shared_layers_are_inside_the_scanned_set() {
    // 共享层最容易混进领域常量（它在所有模块之间传递数据）。
    // 确认它确实在扫描范围里，别哪天悄悄被加进白名单。
    let scanned: Vec<String> = rust_sources().into_iter().map(|(name, _)| name).collect();
    for module in ["src/models.rs", "src/lib.rs", "src/commands/profile.rs"] {
        assert!(
            scanned.iter().any(|name| name == module),
            "{module} 没被扫到，护栏的覆盖面缩了。"
        );
        assert!(
            !DOMAIN_ADAPTERS.contains(&module),
            "{module} 是共享层，不该在领域适配层白名单里。"
        );
    }
}

#[test]
fn domain_constants_live_outside_the_core() {
    // 反向确认：护栏不是空转的——领域常量确实还在仓库里（领域适配层）。
    let subjects = read_module("src/commands/subjects.rs");
    assert!(
        subjects.contains("语文") && subjects.contains("数学"),
        "领域适配层应该仍然认识学科名，否则护栏没有意义。"
    );
}
