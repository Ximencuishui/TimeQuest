//! 教材 PDF 目录解析：目录页文字行 → 章节树。
//!
//! 目录行的样本取自真实教材（人教版初中数学七年级上册）的目录页，
//! 编号是全角、排在标题右侧，页码跟在同一行末尾。

use timequest_lib::{extract_outline, parse_outline_lines};

fn lines(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

#[test]
fn parses_chapter_and_section_lines() {
    let chapters = parse_outline_lines(&lines(&[
        "目　　录",
        "第一章　有理数",
        "正数和负数１．１　２",
        "有理数１．２　６",
        "有理数的加减法１．３　１６",
        "第二章　整式的加减",
        "整式２．１　５４",
        "整式的加减２．２　６２",
    ]));

    assert_eq!(chapters.len(), 2, "两章");
    assert_eq!(chapters[0].title, "第一章 有理数");
    assert_eq!(chapters[0].sections.len(), 3);
    assert_eq!(chapters[0].sections[0].number, "1.1");
    assert_eq!(chapters[0].sections[0].title, "正数和负数");
    assert_eq!(chapters[0].sections[2].number, "1.3");
    assert_eq!(chapters[0].sections[2].title, "有理数的加减法");
    assert_eq!(chapters[1].title, "第二章 整式的加减");
    assert_eq!(chapters[1].sections.len(), 2);
    assert_eq!(chapters[1].sections[1].number, "2.2");
}

#[test]
fn keeps_section_number_in_front_of_title() {
    let chapters = parse_outline_lines(&lines(&[
        "第一章　几何图形初步",
        "4.1　几何图形",
        "4.2　直线、射线、线段",
    ]));

    assert_eq!(chapters.len(), 1);
    assert_eq!(chapters[0].sections[0].number, "4.1");
    assert_eq!(chapters[0].sections[0].title, "几何图形");
    assert_eq!(chapters[0].sections[1].number, "4.2");
    assert_eq!(chapters[0].sections[1].title, "直线、射线、线段");
}

#[test]
fn ignores_column_headings() {
    let chapters = parse_outline_lines(&lines(&[
        "第一章　有理数",
        "正数和负数１．１　２",
        "实验与探究　填幻方　２１",
        "阅读与思考　中国人最先使用负数　２７",
        "数学活动４９",
        "小结５０",
        "复习题１５１",
    ]));

    assert_eq!(chapters.len(), 1);
    assert_eq!(
        chapters[0].sections.len(),
        1,
        "栏目不是学习单元，不该进任务：{:?}",
        chapters[0].sections
    );
    assert_eq!(chapters[0].sections[0].title, "正数和负数");
}

#[test]
fn joins_wrapped_title_lines() {
    let chapters = parse_outline_lines(&lines(&[
        "第三章　一元一次方程",
        "（一）解一元一次方程３．２",
        "———合并同类项与移项　８６",
    ]));

    assert_eq!(chapters.len(), 1);
    assert_eq!(chapters[0].sections.len(), 1);
    assert_eq!(chapters[0].sections[0].number, "3.2");
    assert!(
        chapters[0].sections[0].title.contains("合并同类项与移项"),
        "折行的标题要接回上一条：{}",
        chapters[0].sections[0].title
    );
}

#[test]
fn keeps_chapter_number_with_arabic_digits() {
    let chapters = parse_outline_lines(&lines(&[
        "第 3 单元　函数",
        "3.1　函数的概念",
    ]));

    assert_eq!(chapters.len(), 1);
    assert_eq!(chapters[0].title, "第3单元 函数");
    assert_eq!(chapters[0].sections[0].number, "3.1");
}

#[test]
fn extracts_overview_without_toc_guessing_numbers() {
    let chapters = parse_outline_lines(&lines(&[
        "第一章　有理数",
        "数字1与字母X的对话",
    ]));

    assert_eq!(chapters.len(), 1);
    assert!(
        chapters[0].sections.is_empty(),
        "标题里的数字不是小节编号：{:?}",
        chapters[0].sections
    );
}

#[test]
fn extract_outline_rejects_garbage_bytes() {
    let error = extract_outline(b"not a pdf at all").expect_err("must fail");
    assert!(error.contains("PDF"), "错误要说清是 PDF 解析失败：{error}");
}

#[test]
fn extract_outline_reports_missing_toc_page() {
    let error = extract_outline(include_bytes!("fixtures/plain_text.pdf")).expect_err("must fail");
    assert!(
        error.contains("目录"),
        "找不到目录页要说清原因：{error}"
    );
}

#[test]
fn extracts_chapters_and_sections_from_a_real_toc_layout() {
    let chapters = extract_outline(include_bytes!("fixtures/toc_layout.pdf")).expect("parse toc");

    assert_eq!(
        chapters.len(),
        3,
        "三章都要认出来：{chapters:?}"
    );
    assert_eq!(chapters[0].title, "第一章 有理数");
    assert_eq!(chapters[1].title, "第二章 整式的加减");
    assert_eq!(chapters[2].title, "第三章 一元一次方程");

    assert_eq!(chapters[0].sections.len(), 2);
    assert_eq!(chapters[0].sections[0].number, "1.1");
    assert_eq!(chapters[0].sections[0].title, "正数和负数");
    assert_eq!(chapters[0].sections[1].number, "1.2");
    assert_eq!(chapters[0].sections[1].title, "有理数");

    assert_eq!(chapters[1].sections.len(), 2, "第二章跨页也要收齐");
    assert_eq!(chapters[1].sections[0].number, "2.1");
    assert_eq!(chapters[1].sections[0].title, "整式");
    assert_eq!(chapters[1].sections[1].number, "2.2");
    assert_eq!(chapters[1].sections[1].title, "整式的加减");

    assert_eq!(chapters[2].sections.len(), 3);
    assert_eq!(chapters[2].sections[0].number, "3.1");
    assert_eq!(chapters[2].sections[0].title, "从算式到方程");
    assert_eq!(chapters[2].sections[1].number, "3.2");
    assert!(
        chapters[2].sections[1].title.contains("合并同类项与移项"),
        "折行的标题要接回上一条：{}",
        chapters[2].sections[1].title
    );
    assert_eq!(chapters[2].sections[2].number, "3.3");
}

#[test]
fn toc_page_number_column_does_not_leak_into_titles() {
    let chapters = extract_outline(include_bytes!("fixtures/toc_layout.pdf")).expect("parse toc");

    for chapter in &chapters {
        for section in &chapter.sections {
            assert!(
                !section.title.chars().any(|c| c.is_ascii_digit()),
                "页码不该混进标题：{section:?}"
            );
        }
    }
}

#[test]
fn index_entry_is_not_appended_to_the_previous_section() {
    let chapters = extract_outline(include_bytes!("fixtures/toc_layout.pdf")).expect("parse toc");

    let last = chapters.last().expect("chapter");
    let last_section = last.sections.last().expect("section");
    assert!(
        !last_section.title.contains("部分中英文词汇索引"),
        "索引条目不是折行，不该接到上一条标题后面：{}",
        last_section.title
    );
}

#[test]
fn column_headings_are_not_treated_as_sections() {
    let chapters = extract_outline(include_bytes!("fixtures/toc_layout.pdf")).expect("parse toc");

    let titles: Vec<&str> = chapters
        .iter()
        .flat_map(|chapter| chapter.sections.iter())
        .map(|section| section.title.as_str())
        .collect();
    for heading in ["实验与探究", "信息技术应用", "小结", "数学活动"] {
        assert!(
            !titles.iter().any(|title| title.contains(heading)),
            "栏目不是学习单元：{titles:?}"
        );
    }
}
