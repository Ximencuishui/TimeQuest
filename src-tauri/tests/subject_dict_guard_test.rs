//! 护栏：各科目标的权威源是 `subjects.goal`，不是旧档案的 `user_profile.subject_targets`。
//!
//! `subject_targets` 是 3.x 留下来的兼容列，4.0 起只允许出现在导出 / 导入两层里。
//! 任何业务代码再读它，这条测试就红。

use std::path::{Path, PathBuf};

/// 递归收集指定扩展名的文件。
fn collect_files(dir: &Path, exts: &[&str], out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, exts, out);
            continue;
        }
        let matches = path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| exts.contains(&ext));
        if matches {
            out.push(path);
        }
    }
}

/// 统一成 `/` 分隔，Windows / Linux 上比对才一致。
fn normalize(path: &Path, base: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

#[test]
fn rust_business_code_never_reads_subject_targets() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    collect_files(&manifest.join("src"), &["rs"], &mut files);

    let mut offenders = Vec::new();
    for file in files {
        if !read(&file).contains("subject_targets") {
            continue;
        }
        let rel = normalize(&file, &manifest);
        // 只有导出 / 导入的兼容层可以碰这一列。
        if rel == "src/commands/data.rs" {
            continue;
        }
        offenders.push(rel);
    }

    assert!(
        offenders.is_empty(),
        "各科目标的权威源是 `subjects.goal`；只有导出/导入兼容层可以碰 `subject_targets`。\
         但这些文件里还有：{offenders:?}"
    );
}

#[test]
fn frontend_never_reads_subject_targets() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo = manifest.parent().expect("repo root").to_path_buf();
    let mut files = Vec::new();
    collect_files(&repo.join("src"), &["ts", "tsx"], &mut files);

    let mut offenders = Vec::new();
    for file in files {
        if !read(&file).contains("subject_targets") {
            continue;
        }
        offenders.push(normalize(&file, &repo));
    }

    assert!(
        offenders.is_empty(),
        "前端不再读 `user_profile.subject_targets`；但这些文件里还有：{offenders:?}"
    );
}
