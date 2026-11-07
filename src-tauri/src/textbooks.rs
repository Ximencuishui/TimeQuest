//! Built-in textbook outlines. `build.rs` scans `resources/textbooks/*.json`
//! and embeds each file, so lookup works in tests and in the packaged app
//! without reading the install directory. The same folder is also listed in
//! `tauri.conf.json` bundle resources.

use crate::error::TextbookError;
use serde::de::{self, Deserializer};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

include!(concat!(env!("OUT_DIR"), "/builtin_textbooks.rs"));

/// One book: chapters in teaching order, each with its sections.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextbookOutline {
    pub subject: String,
    pub version: String,
    pub volume: String,
    pub chapters: Vec<TextbookChapter>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextbookChapter {
    /// Chapter title. JSON key is `name`; `chapter` is accepted when reading older files.
    #[serde(alias = "chapter")]
    pub name: String,
    pub sections: Vec<TextbookSection>,
}

/// One section. Tasks are still created per section name.
///
/// JSON may be a string (`"1.1 集合的概念"`) or an object with `name` and
/// `knowledge_points`. Missing `knowledge_points` means an empty list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TextbookSection {
    pub name: String,
    #[serde(default)]
    pub knowledge_points: Vec<String>,
}

impl<'de> Deserialize<'de> for TextbookSection {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        match value {
            Value::String(text) => section_from_name(&text).map_err(de::Error::custom),
            Value::Object(_) => {
                #[derive(Deserialize)]
                struct Wire {
                    name: String,
                    #[serde(default)]
                    knowledge_points: Vec<String>,
                }
                let wire: Wire = serde_json::from_value(value).map_err(de::Error::custom)?;
                let mut section = section_from_name(&wire.name).map_err(de::Error::custom)?;
                section.knowledge_points =
                    normalize_knowledge_points(wire.knowledge_points).map_err(de::Error::custom)?;
                Ok(section)
            }
            _ => Err(de::Error::custom(
                "section must be a string or an object with name",
            )),
        }
    }
}

fn section_from_name(text: &str) -> Result<TextbookSection, String> {
    let name = text.trim();
    if name.is_empty() {
        return Err("section name is empty".into());
    }
    Ok(TextbookSection {
        name: name.to_string(),
        knowledge_points: Vec::new(),
    })
}

fn normalize_knowledge_points(points: Vec<String>) -> Result<Vec<String>, String> {
    let mut names = Vec::with_capacity(points.len());
    for (index, point) in points.into_iter().enumerate() {
        let point = point.trim();
        if point.is_empty() {
            return Err(format!("knowledge_points[{index}] is empty"));
        }
        if !names.iter().any(|existing: &String| existing == point) {
            names.push(point.to_string());
        }
    }
    Ok(names)
}

/// Load the built-in outline for `(subject, version, volume)`.
///
/// Keys are matched after trimming the arguments.
pub fn get_textbook_outline(
    subject: &str,
    version: &str,
    volume: &str,
) -> Result<TextbookOutline, TextbookError> {
    let subject = subject.trim();
    let version = version.trim();
    let volume = volume.trim();
    builtin_outlines()?
        .into_iter()
        .find(|book| book.subject == subject && book.version == version && book.volume == volume)
        .ok_or_else(|| TextbookError::NotFound {
            subject: subject.to_string(),
            version: version.to_string(),
            volume: volume.to_string(),
        })
}

/// Parse one textbook file.
///
/// Required shape, after a converter has turned an external taxonomy into this tree:
///
/// ```json
/// {
///   "subject": "数学",
///   "version": "人教版",
///   "volume": "必修第一册",
///   "chapters": [
///     {
///       "name": "第一章",
///       "sections": [
///         {
///           "name": "1.1 集合的概念",
///           "knowledge_points": ["集合的含义"]
///         }
///       ]
///     }
///   ]
/// }
/// ```
///
/// A section may still be a plain string. `subject` / `version` / `volume` /
/// chapter `name` / each section name must be non-empty. Titles are trimmed.
/// Extra fields are ignored. A chapter object may use `chapter` instead of `name`.
pub fn parse_textbook_json(raw: &str) -> Result<TextbookOutline, TextbookError> {
    let raw = raw.trim_start_matches('\u{feff}').trim();
    let value: Value =
        serde_json::from_str(raw).map_err(|err| TextbookError::InvalidJson(err.to_string()))?;
    let Some(obj) = value.as_object() else {
        return Err(TextbookError::InvalidOutline(
            "textbook json must be an object with subject, version, volume, and chapters".into(),
        ));
    };
    let subject = required_text(obj, "subject", "subject")?;
    let version = required_text(obj, "version", "version")?;
    let volume = required_text(obj, "volume", "volume")?;
    let Some(chapters_value) = obj.get("chapters") else {
        return Err(TextbookError::InvalidOutline("missing chapters".into()));
    };
    let Some(chapters_raw) = chapters_value.as_array() else {
        return Err(TextbookError::InvalidOutline(
            "chapters must be an array".into(),
        ));
    };
    if chapters_raw.is_empty() {
        return Err(TextbookError::EmptyOutline);
    }

    let mut chapters = Vec::with_capacity(chapters_raw.len());
    for (index, chapter_value) in chapters_raw.iter().enumerate() {
        let Some(chapter_obj) = chapter_value.as_object() else {
            return Err(TextbookError::InvalidOutline(format!(
                "chapters[{index}] must be an object"
            )));
        };
        let title = chapter_title(chapter_obj, index)?;
        let Some(sections_value) = chapter_obj.get("sections") else {
            return Err(TextbookError::InvalidOutline(format!(
                "chapters[{index}] is missing sections"
            )));
        };
        let Some(sections_raw) = sections_value.as_array() else {
            return Err(TextbookError::InvalidOutline(format!(
                "chapters[{index}].sections must be an array"
            )));
        };
        if sections_raw.is_empty() {
            return Err(TextbookError::InvalidOutline(format!(
                "chapters[{index}] has no sections"
            )));
        }
        let mut sections = Vec::with_capacity(sections_raw.len());
        for (section_index, section_value) in sections_raw.iter().enumerate() {
            sections.push(parse_section(section_value, index, section_index)?);
        }
        chapters.push(TextbookChapter {
            name: title,
            sections,
        });
    }

    let outline = TextbookOutline {
        subject,
        version,
        volume,
        chapters,
    };
    validate_outline(&outline)?;
    Ok(outline)
}

fn parse_section(
    value: &Value,
    chapter_index: usize,
    section_index: usize,
) -> Result<TextbookSection, TextbookError> {
    let label = format!("chapters[{chapter_index}].sections[{section_index}]");
    match value {
        Value::String(text) => {
            let name = text.trim();
            if name.is_empty() {
                return Err(TextbookError::InvalidOutline(format!("{label} is empty")));
            }
            Ok(TextbookSection {
                name: name.to_string(),
                knowledge_points: Vec::new(),
            })
        }
        Value::Object(obj) => {
            let name = required_text(obj, "name", &format!("{label}.name"))?;
            let knowledge_points = match obj.get("knowledge_points") {
                None => Vec::new(),
                Some(Value::Array(items)) => {
                    let mut names = Vec::with_capacity(items.len());
                    for (point_index, item) in items.iter().enumerate() {
                        let Some(text) = item.as_str() else {
                            return Err(TextbookError::InvalidOutline(format!(
                                "{label}.knowledge_points[{point_index}] must be a string"
                            )));
                        };
                        let text = text.trim();
                        if text.is_empty() {
                            return Err(TextbookError::InvalidOutline(format!(
                                "{label}.knowledge_points[{point_index}] is empty"
                            )));
                        }
                        if !names.iter().any(|existing: &String| existing == text) {
                            names.push(text.to_string());
                        }
                    }
                    names
                }
                Some(_) => {
                    return Err(TextbookError::InvalidOutline(format!(
                        "{label}.knowledge_points must be an array"
                    )));
                }
            };
            Ok(TextbookSection {
                name,
                knowledge_points,
            })
        }
        _ => Err(TextbookError::InvalidOutline(format!(
            "{label} must be a string or an object"
        ))),
    }
}

fn chapter_title(chapter_obj: &Map<String, Value>, index: usize) -> Result<String, TextbookError> {
    let label = format!("chapters[{index}].name");
    if chapter_obj.contains_key("name") {
        return required_text(chapter_obj, "name", &label);
    }
    if chapter_obj.contains_key("chapter") {
        return required_text(chapter_obj, "chapter", &label);
    }
    Err(TextbookError::InvalidOutline(format!(
        "chapters[{index}] is missing name"
    )))
}

fn required_text(
    obj: &Map<String, Value>,
    field: &str,
    label: &str,
) -> Result<String, TextbookError> {
    match obj.get(field) {
        None => Err(TextbookError::InvalidOutline(format!("missing {label}"))),
        Some(Value::String(text)) => {
            let text = text.trim();
            if text.is_empty() {
                Err(TextbookError::InvalidOutline(format!("{label} is empty")))
            } else {
                Ok(text.to_string())
            }
        }
        Some(_) => Err(TextbookError::InvalidOutline(format!(
            "{label} must be a string"
        ))),
    }
}

pub(crate) fn validate_outline(outline: &TextbookOutline) -> Result<(), TextbookError> {
    let mut count = 0usize;
    for chapter in &outline.chapters {
        if chapter.name.trim().is_empty() {
            return Err(TextbookError::InvalidOutline(
                "chapter title is empty".into(),
            ));
        }
        for section in &chapter.sections {
            if section.name.trim().is_empty() {
                return Err(TextbookError::InvalidOutline(
                    "section title is empty".into(),
                ));
            }
            count += 1;
        }
    }
    if count == 0 {
        return Err(TextbookError::EmptyOutline);
    }
    Ok(())
}

/// Sections in chapter order. Index `0` is the first section of the first chapter.
pub(crate) fn outline_sections(outline: &TextbookOutline) -> Vec<&str> {
    outline
        .chapters
        .iter()
        .flat_map(|chapter| chapter.sections.iter().map(|section| section.name.as_str()))
        .collect()
}

/// Metadata for one embedded textbook file. Chapters stay out of this list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AvailableTextbook {
    pub subject: String,
    pub version: String,
    pub volume: String,
}

/// Every built-in book, sorted by subject, version, then volume.
pub fn list_available_textbooks() -> Result<Vec<AvailableTextbook>, TextbookError> {
    let mut books = builtin_outlines()?;
    books.sort_by(|left, right| {
        (&left.subject, &left.version, &left.volume).cmp(&(
            &right.subject,
            &right.version,
            &right.volume,
        ))
    });
    Ok(books
        .into_iter()
        .map(|book| AvailableTextbook {
            subject: book.subject,
            version: book.version,
            volume: book.volume,
        })
        .collect())
}

pub(crate) fn builtin_outlines() -> Result<Vec<TextbookOutline>, TextbookError> {
    let mut books = Vec::with_capacity(BUILTIN_TEXTBOOK_JSON.len());
    for raw in BUILTIN_TEXTBOOK_JSON {
        let outline: TextbookOutline =
            serde_json::from_str(raw).map_err(|err| TextbookError::InvalidJson(err.to_string()))?;
        validate_outline(&outline)?;
        if books.iter().any(|existing: &TextbookOutline| {
            existing.subject == outline.subject
                && existing.version == outline.version
                && existing.volume == outline.volume
        }) {
            return Err(TextbookError::InvalidJson(format!(
                "duplicate textbook {} / {} / {}",
                outline.subject, outline.version, outline.volume
            )));
        }
        books.push(outline);
    }
    Ok(books)
}
