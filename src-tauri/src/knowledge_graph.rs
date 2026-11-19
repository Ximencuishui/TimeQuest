//! 知识图谱插件的数据模型、解析与前置回溯。
//!
//! 数据来自 [cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy)，
//! 许可证 CC BY-NC 4.0。插件自带按学科切好的知识点节点与先修边：
//! 数学、物理随应用内置，其余学科下载后落到插件目录。
//!
//! 这一层是纯函数：解析、筛选、前置回溯都不碰数据库和文件系统，方便单测。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 内置数据文件里记的许可证标识。
pub const KNOWLEDGE_GRAPH_LICENSE: &str = "CC BY-NC 4.0";

/// 硬先修：不会这个基本学不会下一个。
pub const STRENGTH_HARD: &str = "hard";

/// 回溯的最大深度。上游数据理论上无环，这里兜底防止绕圈。
const MAX_CHAIN_DEPTH: u32 = 8;

/// 学段标签。
pub const STAGE_PRIMARY: &str = "小学";
pub const STAGE_JUNIOR: &str = "初中";
pub const STAGE_SENIOR: &str = "高中";
pub const STAGE_UNKNOWN: &str = "其他";

/// 知识点自带的诊断题。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticQuestion {
    pub question: String,
    pub answer: String,
}

/// 知识点引用到的数学知识点。物理用这个字段连数学，不算先修边。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MathLink {
    pub id: String,
    #[serde(default)]
    pub reason: String,
}

/// 一个知识点节点。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeTopic {
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// 领域，例如「数与代数」「运动和相互作用」。
    #[serde(default)]
    pub domain: String,
    /// 年级：1–6 小学，7–9 初中，10 及以上高中。
    #[serde(default)]
    pub grade: i64,
    /// 学段：小学 / 初中 / 高中 / 其他。解析时按年级填好，前端直接用。
    #[serde(default)]
    pub stage: String,
    #[serde(default)]
    pub semester: String,
    /// 人教版章节，例如「七上 第一章 有理数 1.2.1」。
    #[serde(default)]
    pub chapter: String,
    /// 知识点类型：conceptual / procedural / reasoning / application / modeling。
    #[serde(rename = "type", default)]
    pub topic_type: String,
    #[serde(default)]
    pub description: String,
    /// 掌握标准。
    ///
    /// 内置包由构建脚本写成 camelCase（`masteryCriteria`），上游原始文件是
    /// snake_case（`mastery_criteria`）。两种命名都要认，否则下载下来的学科包
    /// 会把这一项悄悄丢掉。
    #[serde(default, alias = "mastery_criteria")]
    pub mastery_criteria: Vec<String>,
    /// 诊断题。同样兼容上游的 snake_case 写法。
    #[serde(default, alias = "diagnostic_question")]
    pub diagnostic_question: Option<DiagnosticQuestion>,
    #[serde(default)]
    pub math_links: Vec<MathLink>,
}

impl KnowledgeTopic {
    /// 按年级推学段：1–6 小学，7–9 初中，10 及以上高中。
    pub fn stage_of_grade(&self) -> &'static str {
        match self.grade {
            1..=6 => STAGE_PRIMARY,
            7..=9 => STAGE_JUNIOR,
            10.. => STAGE_SENIOR,
            _ => STAGE_UNKNOWN,
        }
    }

    /// 这个知识点属于哪个学段。字段里已经填好就用字段。
    pub fn stage_of(&self) -> &str {
        let stage = self.stage.trim();
        if stage.is_empty() {
            self.stage_of_grade()
        } else {
            stage
        }
    }

    /// 把学段写进字段，前端按学段分组时不用自己再推一遍年级。
    pub fn fill_stage(&mut self) {
        if self.stage.trim().is_empty() {
            self.stage = self.stage_of_grade().to_string();
        }
    }
}

/// 一条先修边：`topic_id` 依赖 `prerequisite_id`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDependency {
    pub topic_id: String,
    pub prerequisite_id: String,
    /// `hard`（硬门槛）或 `soft`（有帮助但不是门槛）。
    #[serde(default = "default_strength")]
    pub strength: String,
    #[serde(default)]
    pub reason: String,
}

fn default_strength() -> String {
    "soft".to_string()
}

impl KnowledgeDependency {
    /// 是不是硬门槛。
    pub fn is_hard(&self) -> bool {
        self.strength == STRENGTH_HARD
    }
}

/// 知识点节点文件（内置包和下载缓存用同一个格式）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeTopicsFile {
    #[serde(default)]
    pub schema: i64,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub subject_name: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub generated_at: String,
    #[serde(default)]
    pub commit: String,
    #[serde(default)]
    pub count: usize,
    pub topics: Vec<KnowledgeTopic>,
}

/// 先修边文件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDependenciesFile {
    #[serde(default)]
    pub schema: i64,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub subject_name: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub generated_at: String,
    #[serde(default)]
    pub commit: String,
    #[serde(default)]
    pub count: usize,
    pub dependencies: Vec<KnowledgeDependency>,
}

/// 上游一个数据文件的信息（下载时按 sha 锁定内容）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSourceFile {
    pub path: String,
    #[serde(default)]
    pub sha: String,
    #[serde(default)]
    pub size: u64,
}

/// 一个学科包的概览。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgePack {
    pub subject: String,
    pub name: String,
    /// 知识点 id 前缀。多个前缀用逗号分隔（「其他学科」包会这样）。
    #[serde(default)]
    pub prefix: String,
    pub count: usize,
}

/// 学科包清单：有哪些学科、内置了哪些、其余怎么下。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgePacks {
    #[serde(default)]
    pub schema: i64,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub repo: String,
    #[serde(default)]
    pub raw_base: String,
    #[serde(default)]
    pub commit: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub license_url: String,
    #[serde(default)]
    pub generated_at: String,
    /// 上游数据文件：`topics` 和 `dependencies`。
    #[serde(default)]
    pub files: HashMap<String, KnowledgeSourceFile>,
    /// 随应用内置的学科。
    #[serde(default)]
    pub builtin: Vec<KnowledgePack>,
    /// 需要下载的学科。
    #[serde(default)]
    pub downloadable: Vec<KnowledgePack>,
}

impl KnowledgePacks {
    /// 某个学科的包信息，内置和可下载都找一遍。
    pub fn find(&self, subject: &str) -> Option<&KnowledgePack> {
        let subject = subject.trim();
        self.builtin
            .iter()
            .chain(self.downloadable.iter())
            .find(|pack| pack.subject == subject)
    }

    /// 某个学科的 id 前缀列表。「其他学科」包是逗号分隔的多个前缀。
    pub fn prefixes_of(&self, subject: &str) -> Vec<String> {
        self.find(subject)
            .map(|pack| {
                pack.prefix
                    .split(',')
                    .map(|prefix| prefix.trim().to_string())
                    .filter(|prefix| !prefix.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// 解析学科包清单。字段缺失会报错，不静默跳过。
pub fn parse_packs(raw: &str) -> Result<KnowledgePacks, String> {
    let packs: KnowledgePacks =
        serde_json::from_str(raw).map_err(|err| format!("学科包清单解析失败：{err}"))?;
    if packs.repo.trim().is_empty() {
        return Err("学科包清单缺少仓库名".into());
    }
    if !packs.files.contains_key("topics") {
        return Err("学科包清单缺少知识点数据文件".into());
    }
    Ok(packs)
}

/// 解析知识点节点文件。
///
/// 知识点文件有两种形态，都要认：
/// - 上游原始文件是裸数组 `[...]`（下载通道拿到的就是这个）；
/// - 内置包和下载缓存带信封 `{"topics": [...], ...}`。
///
/// 先按信封试，失败再按裸数组试。报错时挑更像用户输入的那一条。
pub fn parse_topics(raw: &str) -> Result<Vec<KnowledgeTopic>, String> {
    let topics = match serde_json::from_str::<KnowledgeTopicsFile>(raw) {
        Ok(file) => file.topics,
        Err(envelope_err) => match serde_json::from_str::<Vec<KnowledgeTopic>>(raw) {
            Ok(topics) => topics,
            Err(bare_err) => {
                return Err(if raw.trim_start().starts_with('[') {
                    format!("知识点数据解析失败：{bare_err}")
                } else {
                    format!("知识点数据解析失败：{envelope_err}")
                });
            }
        },
    };
    let mut topics = topics;
    // 上游数据里没有学段这一列，这里按年级补上，前后端共用一套口径。
    for topic in &mut topics {
        topic.fill_stage();
    }
    Ok(topics)
}

/// 解析先修边文件。同样吃信封和裸数组两种形态。
pub fn parse_dependencies(raw: &str) -> Result<Vec<KnowledgeDependency>, String> {
    let dependencies = match serde_json::from_str::<KnowledgeDependenciesFile>(raw) {
        Ok(file) => file.dependencies,
        Err(envelope_err) => match serde_json::from_str::<Vec<KnowledgeDependency>>(raw) {
            Ok(dependencies) => dependencies,
            Err(bare_err) => {
                return Err(if raw.trim_start().starts_with('[') {
                    format!("先修关系解析失败：{bare_err}")
                } else {
                    format!("先修关系解析失败：{envelope_err}")
                });
            }
        },
    };
    Ok(dependencies)
}

/// 一个学科的完整图谱：知识点 + 先修边。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KnowledgeGraph {
    pub topics: Vec<KnowledgeTopic>,
    pub dependencies: Vec<KnowledgeDependency>,
}

impl KnowledgeGraph {
    /// 用节点和边建图，顺手建好索引。
    pub fn new(topics: Vec<KnowledgeTopic>, dependencies: Vec<KnowledgeDependency>) -> Self {
        Self {
            topics,
            dependencies,
        }
    }

    /// 按 id 找知识点。
    pub fn topic(&self, id: &str) -> Option<&KnowledgeTopic> {
        self.topics.iter().find(|topic| topic.id == id)
    }

    /// 某个知识点的直接先修。hard 在前，同一强度按名字排。
    pub fn direct_prerequisites(&self, topic_id: &str) -> Vec<PrerequisiteNode> {
        let mut nodes: Vec<PrerequisiteNode> = self
            .dependencies
            .iter()
            .filter(|edge| edge.topic_id == topic_id)
            .filter_map(|edge| {
                let topic = self.topic(&edge.prerequisite_id)?;
                Some(PrerequisiteNode {
                    topic: topic.clone(),
                    strength: edge.strength.clone(),
                    reason: edge.reason.clone(),
                    depth: 1,
                })
            })
            .collect();
        sort_prerequisites(&mut nodes);
        nodes
    }

    /// 沿 hard 边回溯出来的深层前置（不含直接先修）。
    ///
    /// 只走硬门槛：软边表示「会了有帮助」，不是必须先会，回溯它会给出
    /// 一大串可有可无的知识点，反而淹没重点。
    pub fn prerequisite_ancestors(&self, topic_id: &str) -> Vec<PrerequisiteNode> {
        let mut seen: HashMap<&str, u32> = HashMap::new();
        seen.insert(topic_id, 0);
        let mut found: Vec<PrerequisiteNode> = Vec::new();
        // 当前层要展开的节点。
        let mut frontier: Vec<(String, u32)> = self
            .direct_prerequisites(topic_id)
            .into_iter()
            .filter(|node| node.strength == STRENGTH_HARD)
            .map(|node| (node.topic.id.clone(), 1u32))
            .collect();

        while let Some((current, depth)) = frontier.pop() {
            if depth >= MAX_CHAIN_DEPTH {
                continue;
            }
            for edge in self.dependencies.iter().filter(|edge| edge.topic_id == current) {
                if !edge.is_hard() {
                    continue;
                }
                let next = edge.prerequisite_id.as_str();
                if seen.contains_key(next) {
                    continue;
                }
                let Some(topic) = self.topic(next) else {
                    continue;
                };
                seen.insert(next, depth + 1);
                found.push(PrerequisiteNode {
                    topic: topic.clone(),
                    strength: edge.strength.clone(),
                    reason: edge.reason.clone(),
                    depth: depth + 1,
                });
                frontier.push((next.to_string(), depth + 1));
            }
        }

        sort_prerequisites(&mut found);
        found
    }
}

/// 先修链上的一环。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrerequisiteNode {
    pub topic: KnowledgeTopic,
    pub strength: String,
    #[serde(default)]
    pub reason: String,
    /// 距离查询点的跳数。1 是直接先修。
    pub depth: u32,
}

/// 先修排序：硬的在前，同强度先近后远，再按名字。
fn sort_prerequisites(nodes: &mut [PrerequisiteNode]) {
    nodes.sort_by(|left, right| {
        left.strength
            .cmp(&right.strength)
            .then(left.depth.cmp(&right.depth))
            .then(left.topic.name.cmp(&right.topic.name))
    });
}

/// 知识点筛选条件。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TopicFilter {
    /// 学段：小学 / 初中 / 高中。空表示不限。
    pub stage: Option<String>,
    /// 关键词，命中名称、章节、领域或说明。
    pub query: Option<String>,
}

/// 按条件筛知识点。关键词忽略大小写，命中任意一个字段就算。
pub fn filter_topics(topics: &[KnowledgeTopic], filter: &TopicFilter) -> Vec<KnowledgeTopic> {
    let stage = filter.stage.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let query = filter
        .query
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase());

    topics
        .iter()
        .filter(|topic| match stage {
            Some(wanted) => topic.stage_of() == wanted,
            None => true,
        })
        .filter(|topic| match &query {
            Some(needle) => {
                topic.name.to_lowercase().contains(needle)
                    || topic.chapter.to_lowercase().contains(needle)
                    || topic.domain.to_lowercase().contains(needle)
                    || topic.description.to_lowercase().contains(needle)
            }
            None => true,
        })
        .cloned()
        .collect()
}

/// 按 id 前缀从全量节点里切出某个学科。
///
/// 上游只发布全量 `topics.json`，没有按学科拆分的文件；下载一个学科包
/// 实际是拉全量再在这里按前缀切。前缀可以多个（「其他学科」包就是）。
pub fn slice_topics_by_prefix(
    topics: &[KnowledgeTopic],
    prefixes: &[String],
) -> Vec<KnowledgeTopic> {
    if prefixes.is_empty() {
        return Vec::new();
    }
    topics
        .iter()
        .filter(|topic| {
            let id = topic.id.as_str();
            prefixes.iter().any(|prefix| id.starts_with(prefix.as_str()))
        })
        .cloned()
        .collect()
}

/// 按 id 前缀从全量边里切出某个学科，只保留两端都在这个学科里的边。
///
/// 上游的边不跨学科，切完自然自洽；这里再筛一遍是为了防止上游以后
/// 加了跨学科边，让子图出现悬空引用。
pub fn slice_dependencies_by_prefix(
    dependencies: &[KnowledgeDependency],
    topics: &[KnowledgeTopic],
    prefixes: &[String],
) -> Vec<KnowledgeDependency> {
    if prefixes.is_empty() {
        return Vec::new();
    }
    let ids: std::collections::HashSet<&str> = topics
        .iter()
        .filter(|topic| {
            let id = topic.id.as_str();
            prefixes.iter().any(|prefix| id.starts_with(prefix.as_str()))
        })
        .map(|topic| topic.id.as_str())
        .collect();
    dependencies
        .iter()
        .filter(|edge| ids.contains(edge.topic_id.as_str()) && ids.contains(edge.prerequisite_id.as_str()))
        .cloned()
        .collect()
}
