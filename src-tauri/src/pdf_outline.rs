//! 教材 PDF 目录解析：把 PDF 目录页的文字流解析成章节树。
//!
//! 教材 PDF 通常没有书签（Outline），目录只印在正文前的「目录」页上。
//! 这里按页面内容流取出每段文字的基线坐标，把同一行的文字并成一行，
//! 再按教材目录的排版习惯切出章与小节：
//!
//! - 章：`第一章 有理数`、`第 3 单元 直线与圆`
//! - 小节：`1.1 正数和负数`、`4.2 直线、射线、线段`
//! - 栏目：`实验与探究`、`小结`、`复习题` 这类不进任务，直接忽略
//!
//! 编号在标题前还是在标题后随排版而定，两种写法都要认。

use crate::pdf_text::{page_font_ids, FontCache};
use crate::textbooks::{validate_outline, TextbookChapter, TextbookOutline, TextbookSection};
use lopdf::content::Content;
use lopdf::{Document, ObjectId};
use serde::{Deserialize, Serialize};

/// 同一行文字的基线距离小于这个值时并成一行。
/// 目录页里同一行的基线会差一两个点，差得多的就不是同一行了。
const SAME_LINE_TOLERANCE: f32 = 5.0;
/// 目录最多翻几页。教材目录通常一两页，封面后也可能夹一页说明。
const MAX_TOC_PAGES: u32 = 6;
/// 同一行里两个片段的起点横坐标相差超过几个字号，就认为中间隔了一栏。
/// 目录页的页码单独占最右边一列，标题和页码之间正好差这么远。
const COLUMN_GAP_EM: f32 = 3.0;
/// 目录页里这些栏目词开头的行是栏目，不是任务单元。
const SECTION_HEADINGS: [&str; 14] = [
    "实验与探究",
    "阅读与思考",
    "观察与猜想",
    "信息技术应用",
    "数学活动",
    "课题学习",
    "综合实践",
    "复习题",
    "习题",
    "思考题",
    "选学",
    "小结",
    "数学活动",
    "本单元小结",
];

/// 一本教材的目录：一串章，每章带一串小节。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutlineChapter {
    /// 章标题，例如 `第一章 有理数`。
    pub title: String,
    /// 该章下的小节。
    pub sections: Vec<OutlineSection>,
}

/// 一个小节：编号与标题分开存，拼回去时再补一个空格。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutlineSection {
    /// 小节编号，例如 `1.1`。
    pub number: String,
    /// 小节标题，例如 `正数和负数`。
    pub title: String,
}

/// 一段文字及其基线坐标。
#[derive(Debug, Clone)]
struct TextItem {
    x: f32,
    y: f32,
    /// 字号，用来判断两个片段之间是不是隔了一栏。
    size: f32,
    text: String,
}

/// 全角字母数字与全角空格转半角。教材目录里的编号和「目　录」标题都是全角。
pub(crate) fn normalize_width(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '\u{3000}' => ' ',
            '\u{ff01}'..='\u{ff5e}' => char::from_u32(c as u32 - 0xfee0).unwrap_or(c),
            _ => c,
        })
        .collect()
}

/// 去掉标题首尾的空白与残留标点。目录里编号被单独排版时会把顿号留在标题开头。
fn trim_title(text: &str) -> String {
    text.trim()
        .trim_matches(|c: char| "、，,。.：:；;！!？?·—-".contains(c))
        .trim()
        .to_string()
}

/// 剥掉行尾的页码。目录页右侧的页码和标题在同一行，不剥掉会粘进标题。
///
/// 数字前面是「.」时不能剥：那说明它是编号的一部分（`1.2`），不是页码。
fn strip_page_number(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut end = bytes.len();
    while end > 0 && bytes[end - 1].is_ascii_digit() {
        end -= 1;
    }
    if end == bytes.len() {
        // 行尾没有数字。
        return line;
    }
    let digits = &line[end..];
    if digits.len() > 4 || end == 0 {
        return line;
    }
    if bytes[end - 1] == b'.' {
        // 数字是编号的一部分（1.2），剥掉会把编号拆坏。
        return line;
    }
    // 页码前面常跟着一个斜杠（`平方根 /2`），一起剥掉，标题才干净。
    line[..end]
        .trim_end()
        .trim_end_matches(|c: char| "/、,，·—–".contains(c))
        .trim_end()
}

/// 判断一行是不是章标题：`第一章`、`第 3 单元` 这类。
fn chapter_title(line: &str) -> Option<String> {
    let rest = line.strip_prefix('第')?.trim_start();
    let mut chars = rest.char_indices();
    let mut digits = String::new();
    let mut consumed = 0usize;
    for (index, c) in chars.by_ref() {
        if c.is_ascii_digit() || "一二三四五六七八九十百千零〇两".contains(c) {
            digits.push(c);
            consumed = index + c.len_utf8();
        } else {
            break;
        }
    }
    if digits.is_empty() {
        return None;
    }
    let tail = rest[consumed..].trim_start();
    let unit = ["章", "节", "单元", "部分", "篇"]
        .iter()
        .find(|unit| tail.starts_with(**unit))?;
    let title = tail[unit.len()..].trim();
    let head = format!("第{digits}{unit}");
    Some(if title.is_empty() {
        head
    } else {
        format!("{head} {}", trim_title(title))
    })
}

/// 判断一行是不是小节。编号可能在标题前（`1.1 正数和负数`），
/// 也可能在标题后（`正数和负数1.1`），两种写法都要认。
fn section_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    // 编号在前：1.1 正数和负数
    let mut chars = trimmed.chars().peekable();
    let mut head = String::new();
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() || c == '.' {
            head.push(c);
            chars.next();
        } else {
            break;
        }
    }
    if head.contains('.') && !head.starts_with('.') && !head.ends_with('.') {
        let title = trim_title(&trimmed[head.len()..]);
        if !title.is_empty() {
            return Some((head, title));
        }
    }

    // 编号在后：正数和负数1.1
    split_number_at_end(trimmed)
}

/// 在行尾找 `1.1` 这样的编号，返回编号与它前面的文字。
/// 行尾的纯数字是页码，先剥掉再找编号。
fn split_number_at_end(line: &str) -> Option<(String, String)> {
    let body = strip_page_number(line).trim();
    let bytes = body.as_bytes();
    let mut start = bytes.len();
    while start > 0 {
        let c = bytes[start - 1] as char;
        if c.is_ascii_digit() || c == '.' {
            start -= 1;
        } else {
            break;
        }
    }
    if start == bytes.len() {
        return None;
    }
    let number = &body[start..];
    if !number.contains('.') || number.starts_with('.') || number.ends_with('.') {
        return None;
    }
    if !number.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    let title = body[..start].trim();
    if title.is_empty() {
        return None;
    }
    Some((number.to_string(), title.to_string()))
}

/// 一行是不是栏目行。
fn is_section_heading(line: &str) -> bool {
    SECTION_HEADINGS
        .iter()
        .any(|heading| line.starts_with(heading))
}

/// 把目录页的文字行解析成章节树。纯函数，便于单测。
pub fn parse_outline_lines(lines: &[String]) -> Vec<OutlineChapter> {
    let mut chapters: Vec<OutlineChapter> = Vec::new();
    // 上一条是不是还没挂页码。没挂页码说明它的标题还没完，下一行是折行。
    let mut awaiting_continuation = false;
    for raw in lines {
        let normalized = normalize_width(raw);
        let trimmed = normalized.trim();
        if trimmed.is_empty() {
            continue;
        }
        // 页码在目录页最右边一列，剥掉再判断这一行是什么。
        let without_page = strip_page_number(trimmed);
        let has_page_number = without_page.len() < trimmed.len();
        if let Some(title) = chapter_title(without_page) {
            chapters.push(OutlineChapter {
                title,
                sections: Vec::new(),
            });
            awaiting_continuation = !has_page_number;
            continue;
        }
        if let Some((number, title)) = section_line(without_page) {
            if let Some(chapter) = chapters.last_mut() {
                chapter.sections.push(OutlineSection { number, title });
            }
            awaiting_continuation = !has_page_number;
            continue;
        }
        if is_section_heading(without_page) {
            awaiting_continuation = false;
            continue;
        }
        // 剩下的行是上一条目的折行，例如「解一元一次方程（一）」后面接的
        // 「——合并同类项与移项」。上一条已经带页码的话，这行是另一个条目，
        // 不能接到上一条标题后面去。
        if awaiting_continuation {
            if let Some(chapter) = chapters.last_mut() {
                if let Some(section) = chapter.sections.last_mut() {
                    let extra = trim_title(without_page);
                    if !extra.is_empty() {
                        section.title = format!("{} {}", section.title, extra);
                    }
                }
            }
        }
        awaiting_continuation = false;
    }
    chapters
}

/// 取一页里每段文字的基线坐标。字体切换、定位和显示操作符都要跟着走。
///
/// 教材 PDF 常常把字号写进 `Tm` 矩阵的缩放里（`24.457 0 0 24.457 x y Tm`），
/// `Tf` 里的字号是 1。所以真实字号 = `Tf` 字号 × 矩阵缩放，
/// 少了这一步就分不清「隔了一栏」和「挨得很近」。
fn page_items<'a>(doc: &'a Document, page_number: u32, cache: &mut FontCache<'a>) -> Vec<TextItem> {
    let Some(page_id) = doc.get_pages().get(&page_number).copied() else {
        return Vec::new();
    };
    // 教材 PDF 的中文是 Type0 字体，字节要靠字体的 ToUnicode 表还原。
    // 同一个字体在整本书里只解析一次，靠缓存复用。
    let fonts = page_font_ids(doc, page_id);
    let ids: Vec<ObjectId> = fonts.iter().map(|(_, id)| *id).collect();
    cache.prepare(doc, &ids);
    let decoders: std::collections::BTreeMap<Vec<u8>, ObjectId> = fonts.into_iter().collect();
    let Ok(content) = Content::decode(&doc.get_page_content(page_id)) else {
        return Vec::new();
    };

    let mut items: Vec<TextItem> = Vec::new();
    let mut font_name: Option<Vec<u8>> = None;
    let mut font_size = 0f32;
    let mut scale = 1f32;
    let (mut x, mut y, mut leading) = (0f32, 0f32, 0f32);

    for operation in &content.operations {
        match operation.operator.as_ref() {
            "Tf" => {
                font_name = operation
                    .operands
                    .first()
                    .and_then(|operand| operand.as_name().ok())
                    .map(|name| name.to_vec());
                font_size = operation
                    .operands
                    .get(1)
                    .and_then(|operand| operand.as_float().ok())
                    .unwrap_or(font_size);
            }
            "BT" => {
                // 文本矩阵重置，定位回到原点。
                x = 0.0;
                y = 0.0;
                scale = 1.0;
            }
            "Td" | "TD" => {
                let tx = operation
                    .operands
                    .first()
                    .and_then(|operand| operand.as_float().ok())
                    .unwrap_or(0.0);
                let ty = operation
                    .operands
                    .get(1)
                    .and_then(|operand| operand.as_float().ok())
                    .unwrap_or(0.0);
                // `Td` 是文本空间里的相对位移，要乘上矩阵缩放才是页面上的距离。
                x += tx * scale;
                y += ty * scale;
                if operation.operator == "TD" {
                    leading = -ty * scale;
                }
            }
            "Tm" => {
                x = operation
                    .operands
                    .get(4)
                    .and_then(|operand| operand.as_float().ok())
                    .unwrap_or(x);
                y = operation
                    .operands
                    .get(5)
                    .and_then(|operand| operand.as_float().ok())
                    .unwrap_or(y);
                let horizontal = operation
                    .operands
                    .first()
                    .and_then(|operand| operand.as_float().ok())
                    .unwrap_or(scale)
                    .abs();
                let vertical = operation
                    .operands
                    .get(3)
                    .and_then(|operand| operand.as_float().ok())
                    .unwrap_or(scale)
                    .abs();
                let next = horizontal.max(vertical);
                if next > 0.0 {
                    scale = next;
                }
            }
            "T*" => {
                y -= leading;
            }
            "Tj" => {
                if let (Some(name), Some(operand)) = (&font_name, operation.operands.first()) {
                    if let Some(id) = decoders.get(name.as_slice()) {
                        let Some(decoder) = cache.get(id) else {
                            continue;
                        };
                        if let Ok(bytes) = operand.as_str() {
                            let text = decoder.decode(bytes);
                            if !text.is_empty() {
                                items.push(TextItem {
                                    x,
                                    y,
                                    size: font_size * scale,
                                    text,
                                });
                            }
                        }
                    }
                }
            }
            "TJ" => {
                if let (Some(name), Some(array)) = (&font_name, operation.operands.first()) {
                    if let Some(id) = decoders.get(name.as_slice()) {
                        let Some(decoder) = cache.get(id) else {
                            continue;
                        };
                        let Ok(parts) = array.as_array() else {
                            continue;
                        };
                        let mut buffer = String::new();
                        for element in parts {
                            if let Ok(bytes) = element.as_str() {
                                buffer.push_str(&decoder.decode(bytes));
                            } else if let Ok(number) = element.as_float() {
                                // 数组里的数字是字距调整（千分之一个字宽），
                                // 标题和页码分开排版时就靠它拉开距离。
                                x += number as f32 * font_size * scale / 1000.0;
                            }
                        }
                        if !buffer.is_empty() {
                            items.push(TextItem {
                                x,
                                y,
                                size: font_size * scale,
                                text: buffer,
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }
    items
}

/// 把一页的文字并成行。同一基线上的片段按 x 从小到大排。
fn page_lines<'a>(doc: &'a Document, page_number: u32, cache: &mut FontCache<'a>) -> Vec<String> {
    let mut items = page_items(doc, page_number, cache);
    items.sort_by(|left, right| {
        right
            .y
            .partial_cmp(&left.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                left.x
                    .partial_cmp(&right.x)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });

    // 基线相近的算同一行。逐条和上一条比，允许行内基线有小幅抖动。
    let mut rows: Vec<Vec<TextItem>> = Vec::new();
    let mut previous_y = 0f32;
    for item in items {
        let same_row = match rows.last() {
            Some(_) => (previous_y - item.y).abs() <= SAME_LINE_TOLERANCE,
            None => false,
        };
        previous_y = item.y;
        if same_row {
            if let Some(row) = rows.last_mut() {
                row.push(item);
            }
        } else {
            rows.push(vec![item]);
        }
    }

    rows.into_iter().map(merge_row).collect()
}

/// 把同一行上的片段接成一行文字。
///
/// 目录页的页码单独占最右边一列，和标题之间隔着一段空白。
/// 空白不补上，标题和页码就会粘成一个字符串（`正数和负数2`），
/// 后面就没法把页码剥下来了。
fn merge_row(row: Vec<TextItem>) -> String {
    let mut row = row;
    // 同一行里基线会有小幅抖动，真正的先后顺序看横坐标。
    row.sort_by(|left, right| {
        left.x
            .partial_cmp(&right.x)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                right
                    .y
                    .partial_cmp(&left.y)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });

    let mut line = String::new();
    let mut previous: Option<(f32, f32)> = None;
    for item in &row {
        if let Some((previous_x, previous_size)) = previous {
            let threshold = COLUMN_GAP_EM * previous_size.max(item.size).max(1.0);
            if item.x - previous_x > threshold {
                line.push(' ');
            }
        }
        line.push_str(&item.text);
        previous = Some((item.x, item.size));
    }
    line
}

/// 这一行是不是目录页的标题行。
fn is_toc_heading(line: &str) -> bool {
    let normalized = normalize_width(line);
    let compact: String = normalized.chars().filter(|c| !c.is_whitespace()).collect();
    compact == "目录"
        || compact.eq_ignore_ascii_case("contents")
        || compact.eq_ignore_ascii_case("tableofcontents")
}

/// 一行是不是以页码结尾。目录页每行右边都挂着页码，正文页没有。
///
/// 教材目录里的页码常带一个斜杠（`平方根与立方根 /2`），也有直接粘着的
/// （`实数/8`），都得认。`11.1` 这种编号不算页码。
fn ends_with_page_number(line: &str) -> bool {
    let normalized = normalize_width(line);
    let Some(token) = normalized.split_whitespace().last() else {
        return false;
    };
    let Some(digits_start) = token.find(|c: char| c.is_ascii_digit()) else {
        return false;
    };
    let prefix = &token[..digits_start];
    let digits = &token[digits_start..];
    if digits.is_empty() || digits.len() > 4 {
        return false;
    }
    if !digits.chars().all(|c| c.is_ascii_digit()) {
        // `11.1` 这种是编号，不是页码。
        return false;
    }
    // 前缀只能是分隔符（斜杠、顿号），不能是字母数字。
    if prefix.chars().any(|c| c.is_ascii_alphanumeric()) {
        return false;
    }
    true
}

/// 一页像不像目录页。目录页每行右边都挂着页码，正文页不会。
///
/// 这是区分「目录」和「正文」最可靠的信号：正文页里也会出现
/// `第一章 有理数` 这种字样，但不会整页都在挂页码。
fn looks_like_toc_page(page: &[String]) -> bool {
    let rows = page.iter().filter(|line| !line.trim().is_empty()).count();
    if rows == 0 {
        return false;
    }
    let marked = page
        .iter()
        .filter(|line| ends_with_page_number(line))
        .count();
    // 目录页一定带章标题。目录跨页时每页不一定都有章标题，
    // 但只要有一页有就行——单页判断放宽，整段判断收紧。
    let chapters = page
        .iter()
        .filter(|line| {
            let normalized = normalize_width(line);
            chapter_title(strip_page_number(normalized.trim())).is_some()
        })
        .count();
    // 页码下限取 2：薄薄一页目录（两三个条目）也要认出来。
    chapters >= 1 && marked >= 2 && marked * 3 >= rows
}

/// 从 PDF 里把目录页的文字行原样取出来，按行返回。
///
/// 目录页从标题行（`目　录`）开始，一直取到不再像目录页为止。
pub fn extract_outline_lines(pdf_bytes: &[u8]) -> Result<Vec<String>, String> {
    let doc = Document::load_mem(pdf_bytes).map_err(|err| format!("PDF 解析失败：{err}"))?;
    let pages = doc.get_pages();
    let mut numbers: Vec<u32> = pages.keys().copied().collect();
    numbers.sort_unstable();
    let mut cache = FontCache::new();

    let Some(start) = numbers.iter().copied().find(|number| {
        page_lines(&doc, *number, &mut cache)
            .iter()
            .any(|line| is_toc_heading(line))
    }) else {
        return Err("这份 PDF 里没找到目录页".into());
    };

    let mut lines: Vec<String> = Vec::new();
    // 目录往往跨好几页。判断偶尔会失手，所以连续两页都不像目录才停。
    let mut misses = 0;
    for offset in 0..MAX_TOC_PAGES {
        let Some(number) = numbers.iter().copied().find(|n| *n >= start + offset) else {
            break;
        };
        let page = page_lines(&doc, number, &mut cache);
        if offset > 0 && !looks_like_toc_page(&page) {
            misses += 1;
            if misses >= 2 {
                // 目录到此为止，后面是正文。
                break;
            }
            continue;
        }
        misses = 0;
        lines.extend(page);
    }
    Ok(lines)
}

/// 每页抽出一点文字，用来判断这份 PDF 到底有没有文本层。
///
/// 扫描版的教材每页都是图片，抽出来是空的：这种情况解析不出目录，
/// 只能靠 OCR，而那不在本程序的职责范围内。
pub fn inspect_pdf_pages(pdf_bytes: &[u8]) -> Result<Vec<String>, String> {
    let doc = Document::load_mem(pdf_bytes).map_err(|err| format!("PDF 解析失败：{err}"))?;
    let pages = doc.get_pages();
    let mut numbers: Vec<u32> = pages.keys().copied().collect();
    numbers.sort_unstable();
    let mut cache = FontCache::new();
    Ok(numbers
        .iter()
        .map(|number| page_lines(&doc, *number, &mut cache).join("\n"))
        .collect())
}

/// 从 PDF 里解析教材目录。
///
/// 找不到目录页，或目录里一个章都没解析出来时返回错误。
pub fn extract_outline(pdf_bytes: &[u8]) -> Result<Vec<OutlineChapter>, String> {
    let lines = extract_outline_lines(pdf_bytes)?;
    let chapters = parse_outline_lines(&lines);
    let chapters: Vec<OutlineChapter> = chapters
        .into_iter()
        .filter(|chapter| !chapter.sections.is_empty())
        .collect();
    if chapters.is_empty() {
        return Err("目录页里没有解析出章节".into());
    }
    Ok(chapters)
}

/// 把解析出来的目录转成教材库里的教材结构。
///
/// 目录只到「章 + 节」，细不到知识点，所以知识点列表是空的，
/// 学生可以在任务详情里自己补。没有小节的章会被丢掉：
/// 教材库要求每章至少有一节，空章留着只会让「按章复习」这类视图出现空洞。
pub fn outline_to_textbook(
    chapters: &[OutlineChapter],
    subject: &str,
    version: &str,
    volume: &str,
) -> Result<TextbookOutline, String> {
    let mut outline_chapters = Vec::with_capacity(chapters.len());
    for chapter in chapters {
        let title = chapter.title.trim();
        if title.is_empty() {
            continue;
        }
        let sections: Vec<TextbookSection> = chapter
            .sections
            .iter()
            .map(|section| TextbookSection {
                name: section_label(section),
                knowledge_points: Vec::new(),
            })
            .filter(|section| !section.name.is_empty())
            .collect();
        if sections.is_empty() {
            continue;
        }
        outline_chapters.push(TextbookChapter {
            name: title.to_string(),
            sections,
        });
    }
    if outline_chapters.is_empty() {
        return Err("这本 PDF 里没有找到可用的目录".into());
    }
    let outline = TextbookOutline {
        subject: subject.trim().to_string(),
        version: version.trim().to_string(),
        volume: volume.trim().to_string(),
        chapters: outline_chapters,
    };
    validate_outline(&outline).map_err(|err| err.to_string())?;
    Ok(outline)
}

/// 小节标题：编号和标题拼在一起，例如 `1.1 正数和负数`。
fn section_label(section: &OutlineSection) -> String {
    let number = section.number.trim();
    let title = section.title.trim();
    match (number.is_empty(), title.is_empty()) {
        (true, _) => title.to_string(),
        (false, true) => number.to_string(),
        (false, false) => format!("{number} {title}"),
    }
}
