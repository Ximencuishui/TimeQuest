//! PDF 文字解码：把内容流里的字节还原成可读文本。
//!
//! 教材 PDF 里的中文大多用 Type0 字体，字符编码是 `/UniGB-UTF16-H`：
//! 一个字符占两个字节，字节本身是字符编码（CID），要靠字体自带的
//! `/ToUnicode` 映射表才能还原成中文。
//!
//! lopdf 只有在 `/Encoding` 写成 `Identity-H` 时才会去读那张表，
//! 碰到 `UniGB-UTF16-H` 就退化成按 UTF-16BE 处理，解出来是一堆乱码。
//! 所以这里自己解析 ToUnicode CMap：`codespacerange` 决定一个字符占几个字节，
//! `bfchar` / `bfrange` 给出编码到 Unicode 的对应关系。
//!
//! 字体没有 `/ToUnicode` 时（英文 PDF 常见），仍然走 lopdf 的编码处理，
//! 保证原有的简单字体行为不变。

use std::collections::HashMap;

use lopdf::{Dictionary, Document, Encoding, Object, ObjectId};

/// ToUnicode 表解压后的上限。
///
/// 正常的教材 ToUnicode 表只有几十 KB。设上限是为了防解压炸弹：
/// 一个坏流解压出来能吃掉几个 GB，把进程直接拖垮。
pub const MAX_TO_UNICODE_BYTES: usize = 4 * 1024 * 1024;

/// 一张 ToUnicode 表最多记多少条映射。
///
/// 教材的 CMap 一般两三千条。设上限是为了挡住病态的 bfrange 区间。
const MAX_MAP_ENTRIES: usize = 200_000;

/// 一段 bfrange 区间最多展开多少个编码。
const MAX_RANGE_SPAN: u32 = 65_535;

/// 一个字体的解码表。
pub struct FontDecoder<'a> {
    /// 一个字符占几个字节。Type0 的中文教材通常是 2。
    bytes: usize,
    /// 字符编码 → 文本。
    map: HashMap<u32, String>,
    /// 没有 ToUnicode 时用 lopdf 的编码处理兜底。
    fallback: Option<Encoding<'a>>,
}

impl<'a> FontDecoder<'a> {
    /// 给一个字体建解码表。
    pub fn new(doc: &'a Document, font: &'a Dictionary) -> FontDecoder<'a> {
        let cmap = font
            .get(b"ToUnicode")
            .ok()
            .and_then(|object| to_unicode_content(doc, object))
            .and_then(|content| parse_to_unicode_cmap(&content));

        match cmap {
            Some((bytes, map)) => FontDecoder {
                bytes,
                map,
                fallback: None,
            },
            None => FontDecoder {
                bytes: 1,
                map: HashMap::new(),
                fallback: font.get_font_encoding(doc).ok(),
            },
        }
    }

    /// 把内容流里的字节还原成文本。
    pub fn decode(&self, bytes: &[u8]) -> String {
        if self.map.is_empty() {
            return match &self.fallback {
                Some(encoding) => Document::decode_text(encoding, bytes).unwrap_or_default(),
                None => String::new(),
            };
        }
        let mut out = String::new();
        let mut index = 0usize;
        while index + self.bytes <= bytes.len() {
            let mut code = 0u32;
            for offset in 0..self.bytes {
                code = (code << 8) | bytes[index + offset] as u32;
            }
            if let Some(text) = self.map.get(&code) {
                out.push_str(text);
            }
            index += self.bytes;
        }
        out
    }
}

/// 字体解码表缓存。
///
/// 教材 PDF 动辄几百个字体、上百页，每页都重新解析一遍 ToUnicode
/// 会慢到不可接受。缓存按字体对象编号来认：不同页的 `/F1` 未必是同一个字体，
/// 只有对象编号相同才算同一个。
pub struct FontCache<'a> {
    decoders: HashMap<ObjectId, FontDecoder<'a>>,
}

impl<'a> FontCache<'a> {
    pub fn new() -> FontCache<'a> {
        FontCache {
            decoders: HashMap::new(),
        }
    }

    /// 把这批字体都建好解码表，已经建过的跳过。
    pub fn prepare(&mut self, doc: &'a Document, ids: &[ObjectId]) {
        for id in ids {
            if self.decoders.contains_key(id) {
                continue;
            }
            let Some(font) = doc
                .get_object(*id)
                .ok()
                .and_then(|object| object.as_dict().ok())
            else {
                continue;
            };
            self.decoders.insert(*id, FontDecoder::new(doc, font));
        }
    }

    /// 取某个字体的解码表。
    pub fn get(&self, id: &ObjectId) -> Option<&FontDecoder<'a>> {
        self.decoders.get(id)
    }
}

impl Default for FontCache<'_> {
    fn default() -> Self {
        FontCache::new()
    }
}

/// 取一页用到的字体：资源名 + 字体对象编号。
///
/// lopdf 的 `get_page_fonts` 只给字体字典，不给对象编号，
/// 而缓存解码表必须按对象编号来认，所以这里自己走一遍资源字典。
pub fn page_font_ids(doc: &Document, page_id: ObjectId) -> Vec<(Vec<u8>, ObjectId)> {
    let Ok((resource_dict, resource_ids)) = doc.get_page_resources(page_id) else {
        return Vec::new();
    };
    let mut out: Vec<(Vec<u8>, ObjectId)> = Vec::new();
    if let Some(resources) = resource_dict {
        collect_font_ids(resources, &mut out);
    }
    for resource_id in resource_ids {
        if let Ok(resources) = doc.get_dictionary(resource_id) {
            collect_font_ids(resources, &mut out);
        }
    }
    out
}

/// 从一份资源字典里挑出字体。同名资源以先遇到的为准。
fn collect_font_ids(resources: &Dictionary, out: &mut Vec<(Vec<u8>, ObjectId)>) {
    let Ok(fonts) = resources.get(b"Font").and_then(|font| font.as_dict()) else {
        return;
    };
    for (name, value) in fonts.iter() {
        let Object::Reference(id) = value else {
            continue;
        };
        if out.iter().any(|(existing, _)| existing == name) {
            continue;
        }
        out.push((name.clone(), *id));
    }
}

/// 取出字体的 `/ToUnicode` 流内容。
fn to_unicode_content(doc: &Document, object: &Object) -> Option<Vec<u8>> {
    let owned = match object {
        Object::Reference(id) => doc.get_object(*id).ok()?,
        other => other,
    };
    owned
        .as_stream()
        .ok()?
        .get_plain_content_with_limit(MAX_TO_UNICODE_BYTES)
        .ok()
}

/// CMap 里的一个记号。
enum Token {
    /// `<...>` 里的十六进制字节。
    Hex(Vec<u8>),
    /// 普通词，例如 `beginbfchar`。
    Word(String),
    /// `[`
    Open,
    /// `]`
    Close,
}

/// 把 CMap 文本切成记号。
///
/// `<...>` 里必须全是十六进制字符，不然就不是编码而是普通文本
/// （CMap 头部的 `<< /Registry (Adobe) ... >>` 就是这种）。
fn tokenize(content: &str) -> Vec<Token> {
    let bytes = content.as_bytes();
    let mut tokens = Vec::new();
    let mut index = 0usize;
    while index < bytes.len() {
        let byte = bytes[index];
        match byte {
            b' ' | b'\t' | b'\r' | b'\n' => index += 1,
            b'%' => {
                // 注释到行尾。
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'<' => {
                let start = index + 1;
                let mut end = start;
                while end < bytes.len() && bytes[end] != b'>' {
                    end += 1;
                }
                let raw = &bytes[start..end.min(bytes.len())];
                if is_hex_string(raw) {
                    tokens.push(Token::Hex(hex_bytes(raw)));
                }
                index = (end + 1).min(bytes.len());
            }
            // CMap 头部 `<< ... >>` 会留下一个落单的 `>`。它不是编码，
            // 直接跳过：当普通字符处理的话这里会原地打转，把内存吃光。
            b'>' => index += 1,
            b'[' => {
                tokens.push(Token::Open);
                index += 1;
            }
            b']' => {
                tokens.push(Token::Close);
                index += 1;
            }
            _ => {
                let start = index;
                while index < bytes.len()
                    && !matches!(
                        bytes[index],
                        b' ' | b'\t' | b'\r' | b'\n' | b'<' | b'>' | b'[' | b']'
                    )
                {
                    index += 1;
                }
                tokens.push(Token::Word(
                    String::from_utf8_lossy(&bytes[start..index]).to_string(),
                ));
            }
        }
    }
    tokens
}

/// 是不是一串合法的十六进制字节。
fn is_hex_string(raw: &[u8]) -> bool {
    !raw.is_empty() && raw.len() % 2 == 0 && raw.iter().all(|byte| byte.is_ascii_hexdigit())
}

/// 十六进制串转字节。
fn hex_bytes(raw: &[u8]) -> Vec<u8> {
    raw.chunks(2)
        .map(|pair| (hex_digit(pair[0]) << 4) | hex_digit(pair[1]))
        .collect()
}

fn hex_digit(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        b'A'..=b'F' => byte - b'A' + 10,
        _ => 0,
    }
}

/// 十六进制字节转成整数。
fn hex_to_u32(raw: &[u8]) -> u32 {
    raw.iter().fold(0u32, |acc, byte| (acc << 8) | *byte as u32)
}

/// UTF-16BE 字节转成文本。
fn utf16be_to_string(raw: &[u8]) -> String {
    let units: Vec<u16> = raw
        .chunks(2)
        .filter(|chunk| chunk.len() == 2)
        .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

/// 解析 ToUnicode CMap，得到「一个字符几个字节」和「编码 → 文本」。
///
/// 返回 None 表示这张表没法用，调用方改走 lopdf 的编码处理。
fn parse_to_unicode_cmap(content: &[u8]) -> Option<(usize, HashMap<u32, String>)> {
    let text = String::from_utf8_lossy(content);
    let tokens = tokenize(&text);
    let mut bytes = 1usize;
    let mut map: HashMap<u32, String> = HashMap::new();
    let mut index = 0usize;

    while index < tokens.len() {
        let Token::Word(word) = &tokens[index] else {
            index += 1;
            continue;
        };
        match word.as_str() {
            "begincodespacerange" => {
                index += 1;
                let mut found = false;
                while index < tokens.len() {
                    if let Token::Word(end) = &tokens[index] {
                        if end == "endcodespacerange" {
                            index += 1;
                            break;
                        }
                    }
                    // 一个字符的编码占几个字节，就看编码有几个字节。
                    if !found {
                        if let Token::Hex(first) = &tokens[index] {
                            if !first.is_empty() && first.len() <= 4 {
                                bytes = first.len();
                                found = true;
                            }
                        }
                    }
                    index += 1;
                }
            }
            "beginbfchar" => {
                index += 1;
                while index + 1 < tokens.len() {
                    let (Token::Hex(source), Token::Hex(target)) =
                        (&tokens[index], &tokens[index + 1])
                    else {
                        break;
                    };
                    if map.len() >= MAX_MAP_ENTRIES {
                        break;
                    }
                    map.insert(hex_to_u32(source), utf16be_to_string(target));
                    index += 2;
                }
            }
            "beginbfrange" => {
                index += 1;
                while index + 1 < tokens.len() {
                    if let Token::Word(end) = &tokens[index] {
                        if end == "endbfrange" {
                            index += 1;
                            break;
                        }
                    }
                    let (Token::Hex(low), Token::Hex(high)) = (&tokens[index], &tokens[index + 1])
                    else {
                        index += 1;
                        continue;
                    };
                    let low = hex_to_u32(low);
                    let high = hex_to_u32(high);
                    index += 2;
                    match tokens.get(index) {
                        Some(Token::Hex(target)) => {
                            let units: Vec<u16> = target
                                .chunks(2)
                                .filter(|chunk| chunk.len() == 2)
                                .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
                                .collect();
                            let span = high.saturating_sub(low).min(MAX_RANGE_SPAN);
                            if units.len() == 1 {
                                // 连续区间：目标值逐个加一。
                                for offset in 0..=span {
                                    if map.len() >= MAX_MAP_ENTRIES {
                                        break;
                                    }
                                    if let Some(ch) = char::from_u32(units[0] as u32 + offset) {
                                        map.insert(low.saturating_add(offset), ch.to_string());
                                    }
                                }
                            } else {
                                map.insert(low, utf16be_to_string(target));
                            }
                            index += 1;
                        }
                        Some(Token::Open) => {
                            // 数组形式：每个目标值对应一个编码。
                            index += 1;
                            let mut offset = 0u32;
                            while let Some(Token::Hex(target)) = tokens.get(index) {
                                if map.len() >= MAX_MAP_ENTRIES {
                                    break;
                                }
                                map.insert(low.saturating_add(offset), utf16be_to_string(target));
                                offset += 1;
                                index += 1;
                            }
                            if matches!(tokens.get(index), Some(Token::Close)) {
                                index += 1;
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => index += 1,
        }
    }

    if map.is_empty() {
        None
    } else {
        Some((bytes, map))
    }
}
