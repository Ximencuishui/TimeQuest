//! 带 Type0 字体的教材 PDF：中文要靠字体的 ToUnicode 表还原。
//!
//! 真实教材的中文一个字占两个字节，字节本身是字符编码，
//! 得查字体的 `/ToUnicode` 映射表才能还原成汉字。
//! lopdf 不认 `/UniGB-UTF16-H` 这种预定义编码，所以 TimeQuest 自己查表。
//!
//! 这里照真实教材的结构造 PDF：
//!
//! - CMap 头部保留 `<< ... >>` 的字典写法。那儿有一个落单的 `>`，
//!   词法分析碰上它会原地打转，把内存吃光。
//! - 目录跨两页，用来钉住「目录续页也要收齐」这条规则。

use lopdf::{dictionary, Document, Object, Stream};
use timequest_lib::extract_outline;

/// 目录里的一行：正文，右边可能挂着页码。
struct TocLine {
    text: String,
    page_number: Option<String>,
}

impl TocLine {
    fn new(text: &str) -> TocLine {
        TocLine {
            text: text.to_string(),
            page_number: None,
        }
    }

    fn with_page(text: &str, page_number: &str) -> TocLine {
        TocLine {
            text: text.to_string(),
            page_number: Some(page_number.to_string()),
        }
    }
}

/// 字体的 ToUnicode 表：字符编码 → 汉字。
struct Cmap {
    entries: Vec<(u32, char)>,
    next: u32,
}

impl Cmap {
    fn new() -> Cmap {
        Cmap {
            entries: Vec::new(),
            next: 0x032c,
        }
    }

    /// 把文字编成两字节一字符的编码串。
    fn encode(&mut self, text: &str) -> Vec<u8> {
        let mut out = Vec::new();
        for ch in text.chars() {
            let code = match self.entries.iter().find(|(_, mapped)| *mapped == ch) {
                Some((code, _)) => *code,
                None => {
                    let code = self.next;
                    self.next += 1;
                    self.entries.push((code, ch));
                    code
                }
            };
            out.push((code >> 8) as u8);
            out.push((code & 0xff) as u8);
        }
        out
    }

    /// 生成 ToUnicode CMap 文本。
    ///
    /// 头部照真实教材写成 `<< /Registry (Adobe) ... >>`，
    /// 那个落单的 `>` 就是会让词法分析卡住的地方。
    fn to_cmap(&self) -> String {
        let mut out = String::new();
        out.push_str("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n");
        out.push_str("/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n");
        out.push_str("/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n");
        out.push_str("1 begincodespacerange\n<032c><03ff>\nendcodespacerange\n");
        out.push_str(&format!("{} beginbfchar\n", self.entries.len()));
        for (code, ch) in &self.entries {
            out.push_str(&format!("<{code:04x}><{:04x}>\n", *ch as u32));
        }
        out.push_str(
            "endbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n",
        );
        out
    }
}

/// 内容流：每一行一次定位加一次显示。
fn build_content(lines: &[(u32, u32, Vec<u8>)]) -> String {
    let mut out = String::from("BT\n/F1 12 Tf\n");
    for (x, y, bytes) in lines {
        let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        out.push_str(&format!("1 0 0 1 {x} {y} Tm <{hex}> Tj\n"));
    }
    out.push_str("ET\n");
    out
}

/// 造一份带 Type0 字体和 ToUnicode 表的目录 PDF。
fn build_toc_pdf(pages: &[Vec<TocLine>]) -> Vec<u8> {
    let mut doc = Document::with_version("1.7");
    let mut cmap = Cmap::new();

    // 先把要写的文字都编码出来，CMap 才覆盖得到每一个字符。
    let mut encoded: Vec<Vec<(u32, u32, Vec<u8>)>> = Vec::new();
    for page in pages {
        let mut lines = Vec::new();
        for (index, line) in page.iter().enumerate() {
            let y = 760 - index as u32 * 20;
            lines.push((60, y, cmap.encode(&line.text)));
            if let Some(number) = &line.page_number {
                lines.push((500, y, cmap.encode(number)));
            }
        }
        encoded.push(lines);
    }

    let cmap_text = cmap.to_cmap();
    let cmap_id = doc.add_object(Stream::new(dictionary! {}, cmap_text.into_bytes()));
    let descriptor_id = doc.add_object(dictionary! {
        "Type" => "FontDescriptor",
        "FontName" => "SimSun",
        "Flags" => 4,
        "FontBBox" => vec![
            Object::Integer(0),
            Object::Integer(0),
            Object::Integer(1000),
            Object::Integer(1000),
        ],
        "ItalicAngle" => 0,
        "Ascent" => 880,
        "Descent" => -120,
        "CapHeight" => 880,
        "StemV" => 80,
    });
    let descendant_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "CIDFontType0",
        "BaseFont" => "SimSun",
        "CIDSystemInfo" => dictionary! {
            "Registry" => "Adobe",
            "Ordering" => "GB1",
            "Supplement" => 2,
        },
        "FontDescriptor" => descriptor_id,
        "DW" => 1000,
    });
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type0",
        "BaseFont" => "SimSun",
        "Encoding" => "UniGB-UTF16-H",
        "DescendantFonts" => vec![Object::Reference(descendant_id)],
        "ToUnicode" => cmap_id,
    });

    let pages_id = doc.add_object(dictionary! { "Type" => "Pages" });
    let mut page_ids = Vec::new();
    for lines in &encoded {
        let content = build_content(lines);
        let content_id = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![
                Object::Integer(0),
                Object::Integer(0),
                Object::Integer(595),
                Object::Integer(842),
            ],
            "Resources" => dictionary! {
                "Font" => dictionary! { "F1" => font_id },
            },
            "Contents" => content_id,
        });
        page_ids.push(page_id);
    }
    {
        let pages = doc
            .get_object_mut(pages_id)
            .expect("pages")
            .as_dict_mut()
            .expect("pages dict");
        pages.set(
            "Kids",
            page_ids
                .iter()
                .map(|id| Object::Reference(*id))
                .collect::<Vec<Object>>(),
        );
        pages.set("Count", page_ids.len() as i64);
    }
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);

    let mut buffer = Vec::new();
    doc.save_to(&mut buffer).expect("save pdf");
    buffer
}

#[test]
fn decodes_chinese_through_the_font_tounicode_table() {
    let pdf = build_toc_pdf(&[vec![
        TocLine::new("目　录"),
        TocLine::new("第11章　数的开方"),
        TocLine::with_page("11.1　平方根与立方根 /", "2"),
        TocLine::with_page("11.2　实数/", "8"),
    ]]);

    let chapters = extract_outline(&pdf).expect("parse toc");

    assert_eq!(chapters.len(), 1, "一章：{chapters:?}");
    assert_eq!(chapters[0].title, "第11章 数的开方");
    assert_eq!(chapters[0].sections.len(), 2, "两小节：{chapters:?}");
    assert_eq!(chapters[0].sections[0].number, "11.1");
    assert_eq!(chapters[0].sections[0].title, "平方根与立方根");
    assert_eq!(chapters[0].sections[1].number, "11.2");
    assert_eq!(chapters[0].sections[1].title, "实数");
}

#[test]
fn a_cmap_dictionary_header_does_not_stall_the_parser() {
    // CMap 头部的 `<< ... >>` 会留下一个落单的 `>`。
    // 词法分析碰上它就原地打转，内存会被吃光，进程直接崩。
    // 这份 PDF 的 CMap 就是这种写法，能解析完说明没卡住。
    let pdf = build_toc_pdf(&[vec![
        TocLine::new("目　录"),
        TocLine::new("第1章　有理数"),
        TocLine::with_page("1.1　正数和负数 /", "2"),
        TocLine::with_page("1.2　有理数 /", "6"),
    ]]);

    let chapters = extract_outline(&pdf).expect("parse toc");

    assert_eq!(chapters.len(), 1);
    assert_eq!(chapters[0].title, "第1章 有理数");
}

#[test]
fn collects_sections_from_a_second_toc_page() {
    let pdf = build_toc_pdf(&[
        vec![
            TocLine::new("目　录"),
            TocLine::new("第11章　数的开方"),
            TocLine::with_page("11.1　平方根与立方根 /", "2"),
        ],
        vec![
            TocLine::new("第12章　整式的乘除"),
            TocLine::with_page("12.1　幂的运算 /", "18"),
            TocLine::with_page("12.2　整式的乘法 /", "25"),
        ],
    ]);

    let chapters = extract_outline(&pdf).expect("parse toc");

    assert_eq!(chapters.len(), 2, "两章：{chapters:?}");
    assert_eq!(chapters[0].title, "第11章 数的开方");
    assert_eq!(chapters[1].title, "第12章 整式的乘除");
    assert_eq!(
        chapters[1].sections.len(),
        2,
        "目录续页的小节也要收齐：{chapters:?}"
    );
    assert_eq!(chapters[1].sections[0].number, "12.1");
    assert_eq!(chapters[1].sections[0].title, "幂的运算");
    assert_eq!(chapters[1].sections[1].number, "12.2");
    assert_eq!(chapters[1].sections[1].title, "整式的乘法");
}

#[test]
fn the_page_number_column_does_not_leak_into_titles() {
    let pdf = build_toc_pdf(&[vec![
        TocLine::new("目　录"),
        TocLine::new("第11章　数的开方"),
        TocLine::with_page("11.1　平方根与立方根 /", "2"),
        TocLine::with_page("11.2　实数/", "8"),
    ]]);

    let chapters = extract_outline(&pdf).expect("parse toc");

    for chapter in &chapters {
        for section in &chapter.sections {
            assert!(
                !section.title.chars().any(|c| c.is_ascii_digit()),
                "页码不该混进标题：{section:?}"
            );
            assert!(
                !section.title.contains('/'),
                "页码前的斜杠不该混进标题：{section:?}"
            );
        }
    }
}
