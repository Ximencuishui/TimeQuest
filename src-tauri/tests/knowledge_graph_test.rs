//! 知识图谱插件：学科包清单、内置数学 / 物理数据、先修回溯。
//!
//! 数据来自开源项目 cn-math-taxonomy（许可证 CC BY-NC 4.0），随应用内置数学与物理。
//! 这一层只测纯函数和内置资源，不联网、不碰数据库。缓存目录相关的用例只碰
//! 临时目录。

use std::collections::HashSet;
use timequest_lib::{
    builtin_packages, downloaded_pack_exists, filter_topics, parse_dependencies, parse_packs,
    parse_topics, plugin_resource_text, slice_dependencies_by_prefix, slice_topics_by_prefix,
    KnowledgeGraph, TopicFilter, STAGE_JUNIOR, STAGE_PRIMARY, STAGE_SENIOR, STAGE_UNKNOWN,
    STRENGTH_HARD,
};

const PLUGIN_ID: &str = "cn-knowledge-graph";

/// 上游原始知识点文件的样子：裸数组，字段名是 snake_case，还带几个我们不用的列。
///
/// 这是下载通道真正拿到的东西，形状必须原样钉住——之前这里按信封格式解析，
/// 一整个下载通道都是坏的。
const UPSTREAM_RAW_TOPICS: &str = r#"[
  {
    "id": "cne_p001",
    "name": "简单词汇认读",
    "domain": "语言运用",
    "grade": 3,
    "semester": "上",
    "chapter": "三年级上册 Unit 1",
    "type": "conceptual",
    "description": "能认读本单元的核心词汇。",
    "mastery_criteria": ["能认读 10 个核心词汇", "能根据中文说出对应英文"],
    "diagnostic_question": {
      "question": "apple 是什么意思？",
      "answer": "苹果"
    },
    "external": false,
    "standards": [{ "id": "cms-2022:1.NA.01", "confidence": "exact" }],
    "root_reason": "三年级从具体词汇入门。"
  }
]"#;

/// 上游原始先修边文件：也是裸数组。
const UPSTREAM_RAW_DEPENDENCIES: &str = r#"[
  {
    "topicId": "cne_p002",
    "prerequisiteId": "cne_p001",
    "strength": "hard",
    "reason": "学习「词汇拼写」需要先掌握「简单词汇认读」。"
  }
]"#;

/// 内置包和下载缓存的样子：带信封，字段名是 camelCase。
const ENVELOPE_TOPICS: &str = r#"{
  "schema": 1,
  "subject": "english",
  "subjectName": "英语",
  "source": "https://github.com/xiaoyang111222/cn-math-taxonomy",
  "license": "CC BY-NC 4.0",
  "generatedAt": "2026-11-19",
  "commit": "aa2c22058222d0df404f1819e2fbdb97a62049ea",
  "count": 1,
  "topics": [
    {
      "id": "cne_p001",
      "name": "简单词汇认读",
      "grade": 3,
      "masteryCriteria": ["能认读 10 个核心词汇"],
      "diagnosticQuestion": { "question": "apple 是什么意思？", "answer": "苹果" }
    }
  ]
}"#;

/// 读插件自带的资源（插件没装也能读到内置的那份）。
fn builtin_text(path: &str) -> String {
    let empty = std::env::temp_dir().join("timequest-no-plugins-installed");
    plugin_resource_text(&empty, PLUGIN_ID, path).expect("builtin resource")
}

/// 内置数学知识点。
fn math_topics() -> Vec<timequest_lib::KnowledgeTopic> {
    parse_topics(&builtin_text("topics.math.json")).expect("math topics")
}

/// 内置物理知识点。
fn physics_topics() -> Vec<timequest_lib::KnowledgeTopic> {
    parse_topics(&builtin_text("topics.physics.json")).expect("physics topics")
}

#[test]
fn packs_manifest_builtin_math_and_physics() {
    let packs = parse_packs(&builtin_text("packs.json")).expect("parse packs");

    assert_eq!(packs.license, "CC BY-NC 4.0", "许可证要写进清单，不能丢");
    assert!(!packs.repo.is_empty(), "清单要锁定仓库");
    assert!(!packs.commit.is_empty(), "清单要锁定提交，否则下载的内容会漂");
    assert!(packs.files.contains_key("topics"));
    assert!(packs.files.contains_key("dependencies"));

    let builtin: Vec<&str> = packs
        .builtin
        .iter()
        .map(|pack| pack.subject.as_str())
        .collect();
    assert_eq!(builtin, vec!["math", "physics"], "只内置数学和物理");

    let downloadable: Vec<&str> = packs
        .downloadable
        .iter()
        .map(|pack| pack.subject.as_str())
        .collect();
    assert!(
        downloadable.contains(&"english") && downloadable.contains(&"chinese"),
        "其余学科要出现在可下载清单里：{downloadable:?}"
    );
}

#[test]
fn packs_manifest_records_subject_prefixes() {
    let packs = parse_packs(&builtin_text("packs.json")).expect("parse packs");

    assert_eq!(packs.prefixes_of("math"), vec!["cnm_".to_string()]);
    assert_eq!(packs.prefixes_of("physics"), vec!["cnp_".to_string()]);
    assert!(
        packs.prefixes_of("other").len() > 1,
        "「其他学科」是多个前缀合起来的：{:?}",
        packs.prefixes_of("other")
    );
    assert!(
        packs.prefixes_of("not-a-subject").is_empty(),
        "清单里没有的学科不该有前缀"
    );
}

#[test]
fn builtin_math_topics_match_upstream_count() {
    let topics = math_topics();

    assert_eq!(topics.len(), 870, "内置数学的知识点数要和上游对得上");
    for topic in &topics {
        assert!(
            topic.id.starts_with("cnm_"),
            "数学包里不该混进别的学科：{}",
            topic.id
        );
        assert!(!topic.name.is_empty(), "知识点要有名字：{}", topic.id);
        assert!(!topic.stage.is_empty(), "学段要填好：{}", topic.id);
    }
}

#[test]
fn builtin_physics_topics_match_upstream_count() {
    let topics = physics_topics();

    assert_eq!(topics.len(), 269, "内置物理的知识点数要和上游对得上");
    for topic in &topics {
        assert!(
            topic.id.starts_with("cnp_"),
            "物理包里不该混进别的学科：{}",
            topic.id
        );
    }
}

#[test]
fn builtin_dependencies_reference_known_topics() {
    let topics = math_topics();
    let dependencies = parse_dependencies(&builtin_text("dependencies.math.json")).expect("deps");

    assert_eq!(dependencies.len(), 1459, "内置数学的先修边数要和上游对得上");
    let ids: HashSet<&str> = topics.iter().map(|topic| topic.id.as_str()).collect();
    for edge in &dependencies {
        assert!(
            ids.contains(edge.topic_id.as_str()),
            "先修边指向不存在的知识点：{}",
            edge.topic_id
        );
        assert!(
            ids.contains(edge.prerequisite_id.as_str()),
            "先修边指向不存在的前置：{}",
            edge.prerequisite_id
        );
        assert!(
            edge.strength == STRENGTH_HARD || edge.strength == "soft",
            "先修强度只有硬门槛和软两种：{}",
            edge.strength
        );
    }
}

#[test]
fn builtin_physics_dependencies_stay_inside_physics() {
    let topics = physics_topics();
    let dependencies = parse_dependencies(&builtin_text("dependencies.physics.json")).expect("deps");

    assert_eq!(dependencies.len(), 637, "内置物理的先修边数要和上游对得上");
    let ids: HashSet<&str> = topics.iter().map(|topic| topic.id.as_str()).collect();
    for edge in &dependencies {
        assert!(
            ids.contains(edge.topic_id.as_str()) && ids.contains(edge.prerequisite_id.as_str()),
            "物理的先修边不该跨出物理：{} <- {}",
            edge.topic_id,
            edge.prerequisite_id
        );
    }
}

#[test]
fn physics_links_to_math_through_math_links_not_dependencies() {
    let topics = physics_topics();

    let linked = topics
        .iter()
        .filter(|topic| {
            topic
                .math_links
                .iter()
                .any(|link| link.id.starts_with("cnm_"))
        })
        .count();
    assert!(
        linked > 0,
        "物理要通过 mathLinks 连到数学，不能塞进先修边"
    );
}

#[test]
fn stage_is_derived_from_grade() {
    let topics = parse_topics(
        r#"{"topics":[
            {"id":"p","grade":3},
            {"id":"j","grade":8},
            {"id":"s","grade":11},
            {"id":"u","grade":0}
        ]}"#,
    )
    .expect("topics");

    assert_eq!(topics[0].stage_of_grade(), STAGE_PRIMARY);
    assert_eq!(topics[1].stage_of_grade(), STAGE_JUNIOR);
    assert_eq!(topics[2].stage_of_grade(), STAGE_SENIOR);
    assert_eq!(topics[3].stage_of_grade(), STAGE_UNKNOWN);
}

#[test]
fn parsed_topics_get_stage_filled_in() {
    let topics = parse_topics(
        r#"{"topics":[{"id":"a","grade":7},{"id":"b","grade":11},{"id":"c","grade":0}]}"#,
    )
    .expect("topics");

    assert_eq!(topics[0].stage, STAGE_JUNIOR);
    assert_eq!(topics[1].stage, STAGE_SENIOR);
    assert_eq!(topics[2].stage, STAGE_UNKNOWN);
}

#[test]
fn filter_topics_matches_any_text_field() {
    let topics = parse_topics(
        r#"{"topics":[
            {"id":"a","name":"有理数","chapter":"七上 第一章","domain":"数与代数","description":"正数与负数"},
            {"id":"b","name":"三角形","chapter":"八下","domain":"图形","description":"内角和"},
            {"id":"c","name":"Algebra","chapter":"X"}
        ]}"#,
    )
    .expect("topics");

    let hit = |query: &str| {
        filter_topics(
            &topics,
            &TopicFilter {
                stage: None,
                query: Some(query.to_string()),
            },
        )
        .len()
    };

    assert_eq!(hit("有理"), 1, "按名字能搜到");
    assert_eq!(hit("八下"), 1, "按章节能搜到");
    assert_eq!(hit("图形"), 1, "按领域能搜到");
    assert_eq!(hit("内角"), 1, "按说明能搜到");
    assert_eq!(hit("algebra"), 1, "搜索忽略大小写");
    assert_eq!(hit("查不到的东西"), 0);
}

#[test]
fn filter_topics_by_stage() {
    let topics = parse_topics(
        r#"{"topics":[{"id":"a","grade":3},{"id":"b","grade":8},{"id":"c","grade":11}]}"#,
    )
    .expect("topics");

    let junior = filter_topics(
        &topics,
        &TopicFilter {
            stage: Some(STAGE_JUNIOR.to_string()),
            query: None,
        },
    );
    assert_eq!(junior.len(), 1);
    assert_eq!(junior[0].id, "b");

    let all = filter_topics(
        &topics,
        &TopicFilter {
            stage: None,
            query: None,
        },
    );
    assert_eq!(all.len(), 3, "不限条件时全部返回");
}

#[test]
fn slice_by_prefix_keeps_subject_and_drops_cross_edges() {
    let topics = parse_topics(
        r#"{"topics":[{"id":"cnm_1"},{"id":"cnp_1"},{"id":"cnm_2"}]}"#,
    )
    .expect("topics");
    let dependencies = parse_dependencies(
        r#"{"dependencies":[
            {"topicId":"cnm_1","prerequisiteId":"cnm_2","strength":"hard","reason":"同科"},
            {"topicId":"cnm_2","prerequisiteId":"cnp_1","strength":"hard","reason":"跨学科"},
            {"topicId":"cnp_1","prerequisiteId":"cnm_1","strength":"soft","reason":"跨学科"}
        ]}"#,
    )
    .expect("deps");

    let prefixes = vec!["cnm_".to_string()];
    let sliced = slice_topics_by_prefix(&topics, &prefixes);
    assert_eq!(sliced.len(), 2, "只切出数学的知识点");

    let edges = slice_dependencies_by_prefix(&dependencies, &topics, &prefixes);
    assert_eq!(edges.len(), 1, "跨学科的边要剔掉");
    assert_eq!(edges[0].topic_id, "cnm_1");
}

#[test]
fn direct_prerequisites_put_hard_before_soft() {
    let graph = KnowledgeGraph::new(
        parse_topics(
            r#"{"topics":[{"id":"t","name":"目标"},{"id":"p1","name":"硬前置"},{"id":"p2","name":"软前置"}]}"#,
        )
        .expect("topics"),
        parse_dependencies(
            r#"{"dependencies":[
                {"topicId":"t","prerequisiteId":"p2","strength":"soft","reason":"s"},
                {"topicId":"t","prerequisiteId":"p1","strength":"hard","reason":"h"}
            ]}"#,
        )
        .expect("deps"),
    );

    let direct = graph.direct_prerequisites("t");
    assert_eq!(direct.len(), 2);
    assert_eq!(direct[0].topic.id, "p1", "硬门槛排前面");
    assert_eq!(direct[0].strength, STRENGTH_HARD);
    assert_eq!(direct[1].topic.id, "p2");
    assert_eq!(direct[1].depth, 1, "直接先修的深度是 1");
}

#[test]
fn ancestors_follow_hard_edges_only() {
    let graph = KnowledgeGraph::new(
        parse_topics(
            r#"{"topics":[{"id":"t"},{"id":"a"},{"id":"c"},{"id":"d"},{"id":"s"},{"id":"b"}]}"#,
        )
        .expect("topics"),
        parse_dependencies(
            r#"{"dependencies":[
                {"topicId":"t","prerequisiteId":"a","strength":"hard"},
                {"topicId":"a","prerequisiteId":"c","strength":"hard"},
                {"topicId":"c","prerequisiteId":"d","strength":"hard"},
                {"topicId":"a","prerequisiteId":"s","strength":"soft"},
                {"topicId":"t","prerequisiteId":"b","strength":"soft"}
            ]}"#,
        )
        .expect("deps"),
    );

    let ancestors = graph.prerequisite_ancestors("t");
    let ids: Vec<&str> = ancestors
        .iter()
        .map(|node| node.topic.id.as_str())
        .collect();
    assert_eq!(ids, vec!["c", "d"], "只沿硬门槛回溯：{ids:?}");
    assert_eq!(ancestors[0].depth, 2);
    assert_eq!(ancestors[1].depth, 3);
}

#[test]
fn ancestors_stop_on_cycles() {
    let graph = KnowledgeGraph::new(
        parse_topics(r#"{"topics":[{"id":"a"},{"id":"b"}]}"#).expect("topics"),
        parse_dependencies(
            r#"{"dependencies":[
                {"topicId":"a","prerequisiteId":"b","strength":"hard"},
                {"topicId":"b","prerequisiteId":"a","strength":"hard"}
            ]}"#,
        )
        .expect("deps"),
    );

    let ancestors = graph.prerequisite_ancestors("a");
    assert!(
        ancestors.len() <= 2,
        "数据里有环也不能一直展开：{}",
        ancestors.len()
    );
}

#[test]
fn packs_rejects_incomplete_manifest() {
    let error = parse_packs(r#"{"repo":"","files":{}}"#).expect_err("must fail");
    assert!(error.contains("仓库名"), "报错要说清缺什么：{error}");

    let error = parse_packs(r#"{"repo":"o/r","files":{}}"#).expect_err("must fail");
    assert!(error.contains("知识点"), "报错要说清缺什么：{error}");

    let error = parse_packs("not json").expect_err("must fail");
    assert!(error.contains("解析失败"), "坏 JSON 要报解析失败：{error}");
}

#[test]
fn knowledge_graph_plugin_declares_resources_and_credits_upstream() {
    let packages = builtin_packages().expect("packages");
    let (package, _) = packages
        .iter()
        .find(|(package, _)| package.id == PLUGIN_ID)
        .expect("知识图谱插件");

    assert!(
        !package.resources.is_empty(),
        "插件要声明自己带的知识点数据"
    );
    for resource in &package.resources {
        assert_eq!(
            resource.kind, "knowledge_graph",
            "资源类型要认得出来：{}",
            resource.path
        );
        assert!(!resource.description.trim().is_empty(), "资源要有一句说明");
    }
    assert!(
        package.author.contains("cn-math-taxonomy"),
        "CC BY-NC 要求署名，作者要写上游仓库：{}",
        package.author
    );
    assert!(
        package.capabilities.len() >= 3,
        "装上之后能多出来的能力要说清楚"
    );
}

#[test]
fn declared_resources_are_all_readable() {
    let packages = builtin_packages().expect("packages");
    let (package, _) = packages
        .iter()
        .find(|(package, _)| package.id == PLUGIN_ID)
        .expect("知识图谱插件");

    let empty = std::env::temp_dir().join("timequest-no-plugins-installed");
    for resource in &package.resources {
        let text = plugin_resource_text(&empty, PLUGIN_ID, &resource.path)
            .expect("read builtin resource");
        assert!(!text.is_empty(), "资源不能是空的：{}", resource.path);
    }
}

/// 上游原始文件是裸数组、字段名是 snake_case。下载通道直接吃这份数据，
/// 掌握标准和诊断题不能被悄悄丢掉。
#[test]
fn upstream_raw_topics_keep_mastery_criteria_and_diagnostic_question() {
    let topics = parse_topics(UPSTREAM_RAW_TOPICS).expect("上游裸数组要能解析");

    assert_eq!(topics.len(), 1, "上游原始文件要能解析出节点");
    let topic = &topics[0];
    assert_eq!(topic.id, "cne_p001");
    assert_eq!(topic.grade, 3);
    assert_eq!(topic.stage, STAGE_PRIMARY, "学段要按年级补上");
    assert_eq!(
        topic.mastery_criteria,
        vec![
            "能认读 10 个核心词汇".to_string(),
            "能根据中文说出对应英文".to_string()
        ],
        "掌握标准不能丢"
    );
    let question = topic.diagnostic_question.as_ref().expect("诊断题不能丢");
    assert_eq!(question.question, "apple 是什么意思？");
    assert_eq!(question.answer, "苹果");
}

/// 上游原始先修边文件也是裸数组，要能解析。
#[test]
fn upstream_raw_dependencies_are_parsed() {
    let dependencies =
        parse_dependencies(UPSTREAM_RAW_DEPENDENCIES).expect("上游裸数组要能解析");

    assert_eq!(dependencies.len(), 1);
    let edge = &dependencies[0];
    assert_eq!(edge.topic_id, "cne_p002");
    assert_eq!(edge.prerequisite_id, "cne_p001");
    assert_eq!(edge.strength, STRENGTH_HARD);
}

/// 内置包和下载缓存带的是信封，字段名 camelCase。两种形态都要认。
#[test]
fn envelope_topics_keep_mastery_criteria_and_diagnostic_question() {
    let topics = parse_topics(ENVELOPE_TOPICS).expect("信封格式要能解析");

    assert_eq!(topics.len(), 1);
    assert_eq!(
        topics[0].mastery_criteria,
        vec!["能认读 10 个核心词汇".to_string()],
        "掌握标准不能丢"
    );
    assert_eq!(
        topics[0]
            .diagnostic_question
            .as_ref()
            .map(|q| q.answer.as_str()),
        Some("苹果"),
        "诊断题不能丢"
    );
}

/// 学科包缓存的两个文件是一套：缺一个都不算下载过。
///
/// 清单里显示「已下载」但点进去发现先修关系是空的，比直接显示可下载更糟。
#[test]
fn a_pack_needs_both_files_to_count_as_downloaded() {
    let dir = std::env::temp_dir().join(format!("timequest-kg-pack-{}", uuid::Uuid::new_v4()));
    let cache = dir.join(PLUGIN_ID).join("packs");
    std::fs::create_dir_all(&cache).expect("建缓存目录");

    assert!(
        !downloaded_pack_exists(&dir, PLUGIN_ID, "english"),
        "一个文件都没有，不算下载过"
    );

    std::fs::write(cache.join("topics.english.json"), "{}").expect("写知识点文件");
    assert!(
        !downloaded_pack_exists(&dir, PLUGIN_ID, "english"),
        "只有知识点文件，先修边还缺，不算下载过"
    );

    std::fs::write(cache.join("dependencies.english.json"), "{}").expect("写先修边文件");
    assert!(
        downloaded_pack_exists(&dir, PLUGIN_ID, "english"),
        "两个文件都在才算下载过"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// 切片结果要跟清单承诺的点数对得上。
///
/// 下载通道切的是同一套上游数据，切法对不上就意味着用户看到的点数跟清单
/// 承诺的不一样。这里用内置的两个学科包钉住这条关系。
#[test]
fn slicing_the_builtin_pack_matches_the_manifest_count() {
    let packs = parse_packs(&builtin_text("packs.json")).expect("parse packs");

    for subject in ["math", "physics"] {
        let pack = packs.find(subject).expect("清单里要有这个学科");
        let prefixes = packs.prefixes_of(subject);

        let topics =
            parse_topics(&builtin_text(&format!("topics.{subject}.json"))).expect("topics");
        let sliced = slice_topics_by_prefix(&topics, &prefixes);
        assert_eq!(
            sliced.len(),
            pack.count,
            "{subject} 切出来的点数要和清单承诺的一致"
        );

        let dependencies =
            parse_dependencies(&builtin_text(&format!("dependencies.{subject}.json")))
                .expect("deps");
        let edges = slice_dependencies_by_prefix(&dependencies, &sliced, &prefixes);
        assert!(!edges.is_empty(), "{subject} 要能切出先修边");
    }
}