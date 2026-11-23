//! 内核零污染护栏。
//!
//! L0 内核（游戏化、排期、统计、场次）必须与赛道无关：
//! 它不认识「语文」「数学」，也不知道总分是 610 还是 750。
//! 一旦内核里出现这些常量，换赛道就会带着高考的假设跑偏。
//!
//! 这条测试直接扫源码，把领域常量挡在内核之外。

use std::fs;
use std::path::PathBuf;

/// 内核模块清单。这些文件不参与赛道适配。
const CORE_MODULES: [&str; 4] = [
    "src/gamification.rs",
    "src/commands/planner.rs",
    "src/commands/stats.rs",
    "src/commands/sessions.rs",
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
        panic!("读不到内核模块 {}：{error}", path.display());
    })
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
fn domain_constants_live_outside_the_core() {
    // 反向确认：护栏不是空转的——领域常量确实还在仓库里（领域适配层）。
    let subjects = read_module("src/commands/subjects.rs");
    assert!(
        subjects.contains("语文") && subjects.contains("数学"),
        "领域适配层应该仍然认识学科名，否则护栏没有意义。"
    );
}
