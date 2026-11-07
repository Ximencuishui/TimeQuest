mod common;

use timequest_lib::{
    generate_tasks_from_outline_impl, get_textbook_outline, import_textbook_json_impl,
    list_available_textbooks, list_textbook_catalog_impl, parse_textbook_json,
    resolve_textbook_outline, GenerateTasksFromOutlineInput, GenerateTasksResult, TextbookError,
};

fn math_input(task_name: &str, selected: &[&str]) -> GenerateTasksFromOutlineInput {
    GenerateTasksFromOutlineInput {
        subject: "数学".into(),
        version: "人教版".into(),
        volume: "必修第一册".into(),
        task_name: task_name.into(),
        selected_sections: selected.iter().map(|name| (*name).to_string()).collect(),
        auto_schedule: true,
    }
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

#[test]
fn get_textbook_outline_returns_pep_math_compulsory_1() {
    let outline =
        get_textbook_outline("数学", "人教版", "必修第一册").expect("builtin pep math book");
    assert_eq!(outline.subject, "数学");
    assert_eq!(outline.version, "人教版");
    assert_eq!(outline.volume, "必修第一册");
    assert_eq!(outline.chapters.len(), 4);
    assert_eq!(outline.chapters[0].name, "第一章 集合与常用逻辑用语");
    assert_eq!(
        &outline.chapters[0].sections[..2],
        ["1.1 集合的概念", "1.2 集合间的基本关系"]
    );
    assert_eq!(outline.chapters[2].name, "第三章 函数的概念与性质");
    assert_eq!(outline.chapters[3].sections[0], "4.1 指数");
    let total: usize = outline
        .chapters
        .iter()
        .map(|chapter| chapter.sections.len())
        .sum();
    assert_eq!(total, 15);

    let trimmed = get_textbook_outline(" 数学 ", "人教版", "必修第一册").unwrap();
    assert_eq!(trimmed.subject, "数学");
}

#[test]
fn get_textbook_outline_rejects_unknown_textbook() {
    let err = get_textbook_outline("历史", "人教版", "必修第一册").unwrap_err();
    assert_eq!(
        err,
        TextbookError::NotFound {
            subject: "历史".into(),
            version: "人教版".into(),
            volume: "必修第一册".into(),
        }
    );
}

#[tokio::test]
async fn generate_tasks_from_outline_counts_sessions_and_records_mastered_as_done() {
    let pool = common::setup().await;
    let xp_before: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let today = today();

    // 1.1 and 2.2 are mastered. Later sections stay planned. All on today.
    let result = generate_tasks_from_outline_impl(
        &pool,
        math_input(
            " 数学必修一 ",
            &["1.1 集合的概念", "2.2 基本不等式", "1.1 集合的概念"],
        ),
    )
    .await
    .expect("generate");

    assert_eq!(
        result,
        GenerateTasksResult {
            task_id: result.task_id,
            total_units: 15,
            planned_count: 13,
            done_count: 2,
        }
    );

    let task: (
        String,
        String,
        Option<String>,
        Option<String>,
        String,
        i64,
        i64,
        i64,
        Option<String>,
        i64,
    ) = sqlx::query_as(
        r#"SELECT title, type, subject, textbook, unit_name, total_units, total_rounds,
                  current_round, color, archived
           FROM tasks WHERE id = ?1"#,
    )
    .bind(result.task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(task.0, "数学必修一");
    assert_eq!(task.1, "main");
    assert_eq!(task.2.as_deref(), Some("数学"));
    assert_eq!(task.3.as_deref(), Some("人教版 必修第一册"));
    assert_eq!(task.4, "节");
    assert_eq!(task.5, 15);
    assert_eq!(task.6, 1);
    assert_eq!(task.7, 1);
    assert_eq!(task.8.as_deref(), Some("#F97316"));
    assert_eq!(task.9, 0);

    let sessions: Vec<(String, i64, i64, String, String, String, i64, i64, String)> =
        sqlx::query_as(
            r#"SELECT status, planned_units, actual_units, date, start_time, end_time, round,
                      xp_awarded, self_note
               FROM task_sessions WHERE task_id = ?1 ORDER BY id ASC"#,
        )
        .bind(result.task_id)
        .fetch_all(&pool)
        .await
        .unwrap();

    let expected = [
        (
            "done",
            1i64,
            1i64,
            today.as_str(),
            "19:00",
            "20:00",
            1i64,
            0i64,
            "1.1 集合的概念",
        ),
        (
            "planned",
            1,
            0,
            today.as_str(),
            "19:00",
            "20:00",
            1,
            0,
            "1.2 集合间的基本关系",
        ),
        (
            "planned",
            1,
            0,
            today.as_str(),
            "19:00",
            "20:00",
            1,
            0,
            "1.3 集合的基本运算",
        ),
        (
            "planned",
            1,
            0,
            today.as_str(),
            "19:00",
            "20:00",
            1,
            0,
            "2.1 等式性质与不等式性质",
        ),
        (
            "done",
            1,
            1,
            today.as_str(),
            "19:00",
            "20:00",
            1,
            0,
            "2.2 基本不等式",
        ),
        (
            "planned",
            1,
            0,
            today.as_str(),
            "19:00",
            "20:00",
            1,
            0,
            "2.3 二次函数与一元二次方程、不等式",
        ),
    ];
    assert_eq!(sessions.len(), 15);
    for (row, expect) in sessions.iter().take(expected.len()).zip(expected) {
        assert_eq!(
            (
                row.0.as_str(),
                row.1,
                row.2,
                row.3.as_str(),
                row.4.as_str(),
                row.5.as_str(),
                row.6,
                row.7,
                row.8.as_str(),
            ),
            expect
        );
    }
    for row in sessions.iter().skip(expected.len()) {
        assert_eq!(row.0, "planned");
        assert_eq!(row.2, 0);
        assert!(!row.8.is_empty());
    }

    let round_units: i64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(actual_units), 0) FROM task_sessions
           WHERE task_id = ?1 AND status = 'done' AND round = 1"#,
    )
    .bind(result.task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(round_units, 2);

    let xp_after: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(xp_after, xp_before);
    let logs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(logs, 0);
}

#[tokio::test]
async fn generate_tasks_mastered_sections_do_not_award_xp_or_achievements() {
    let pool = common::setup().await;
    let outline = get_textbook_outline("数学", "人教版", "必修第一册").unwrap();
    let names: Vec<&str> = outline
        .chapters
        .iter()
        .flat_map(|chapter| chapter.sections.iter().map(String::as_str))
        .collect();
    let total = names.len() as i64;
    let result = generate_tasks_from_outline_impl(&pool, math_input("数学必修一", &names))
        .await
        .expect("generate all mastered");

    assert_eq!(result.total_units, total);
    assert_eq!(result.planned_count, 0);
    assert_eq!(result.done_count, total);

    let xp_rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT status, xp_awarded FROM task_sessions WHERE task_id = ?1")
            .bind(result.task_id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(xp_rows.iter().all(|row| row.0 == "done" && row.1 == 0));

    let (xp, streak, last_done): (i64, i64, Option<String>) = sqlx::query_as(
        "SELECT total_xp, current_streak, last_done_date FROM user_stats WHERE id = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(xp, 0);
    assert_eq!(streak, 0);
    assert!(last_done.is_none());

    let unlocked: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user_achievements")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(unlocked, 0);
    let logs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actual_logs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(logs, 0);
}

#[tokio::test]
async fn generate_tasks_rejects_unknown_section_without_writing() {
    let pool = common::setup().await;

    let err = generate_tasks_from_outline_impl(&pool, math_input("数学必修一", &["不存在的节"]))
        .await
        .unwrap_err();
    assert_eq!(
        err,
        TextbookError::UnknownSection {
            section: "不存在的节".into(),
        }
    );

    let err = generate_tasks_from_outline_impl(&pool, math_input("   ", &[]))
        .await
        .unwrap_err();
    assert_eq!(err, TextbookError::EmptyTitle);

    let tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tasks, 0);
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sessions, 0);
}

const CHINESE_JSON: &str = r#"{
  "subject": " 语文 ",
  "version": "部编版",
  "volume": "必修上册",
  "source": "k12-knowledge-points",
  "chapters": [
    {
      "chapter": " 第一单元 ",
      "sections": [" 1 沁园春·长沙 ", "2 立在地球边上放号"]
    }
  ]
}"#;

#[test]
fn parse_textbook_json_requires_a_chapter_tree() {
    let outline = parse_textbook_json(CHINESE_JSON).unwrap();
    assert_eq!(outline.subject, "语文");
    assert_eq!(outline.chapters[0].name, "第一单元");
    assert_eq!(outline.chapters[0].sections[0], "1 沁园春·长沙");

    let missing = parse_textbook_json(r#"{"subject":"语文","version":"部编版","volume":"上册"}"#)
        .unwrap_err();
    assert_eq!(
        missing,
        TextbookError::InvalidOutline("missing chapters".into())
    );

    let not_array = parse_textbook_json(
        r#"{"subject":"语文","version":"部编版","volume":"上册","chapters":{}}"#,
    )
    .unwrap_err();
    assert_eq!(
        not_array,
        TextbookError::InvalidOutline("chapters must be an array".into())
    );

    let no_sections = parse_textbook_json(
        r#"{"subject":"语文","version":"部编版","volume":"上册","chapters":[{"chapter":"第一单元"}]}"#,
    )
    .unwrap_err();
    assert_eq!(
        no_sections,
        TextbookError::InvalidOutline("chapters[0] is missing sections".into())
    );

    let blank_section = parse_textbook_json(
        r#"{"subject":"语文","version":"部编版","volume":"上册","chapters":[{"chapter":"第一单元","sections":["  "]}]}"#,
    )
    .unwrap_err();
    assert_eq!(
        blank_section,
        TextbookError::InvalidOutline("chapters[0].sections[0] is empty".into())
    );

    let not_object = parse_textbook_json(r#"["第一章"]"#).unwrap_err();
    assert!(matches!(not_object, TextbookError::InvalidOutline(_)));

    let broken = parse_textbook_json("not-json").unwrap_err();
    assert!(matches!(broken, TextbookError::InvalidJson(_)));
}

#[tokio::test]
async fn import_textbook_json_stores_tree_and_replaces_same_key() {
    let pool = common::setup().await;
    let first = import_textbook_json_impl(&pool, CHINESE_JSON)
        .await
        .expect("import");
    assert!(!first.replaced);
    assert_eq!(first.outline.subject, "语文");
    assert_eq!(first.outline.chapters.len(), 1);

    let resolved = resolve_textbook_outline(&pool, "语文", "部编版", "必修上册")
        .await
        .unwrap();
    assert_eq!(resolved.chapters[0].sections.len(), 2);

    let replacement = r#"{
      "subject": "语文",
      "version": "部编版",
      "volume": "必修上册",
      "chapters": [{ "chapter": "第二单元", "sections": ["3 百合花"] }]
    }"#;
    let second = import_textbook_json_impl(&pool, replacement)
        .await
        .expect("replace");
    assert!(second.replaced);
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM imported_textbooks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 1);
    let again = resolve_textbook_outline(&pool, " 语文 ", "部编版", "必修上册")
        .await
        .unwrap();
    assert_eq!(again.chapters[0].name, "第二单元");
    assert_eq!(again.chapters[0].sections, vec!["3 百合花".to_string()]);

    let err = import_textbook_json_impl(
        &pool,
        r#"{"subject":"物理","version":"人教版","volume":"必修一"}"#,
    )
    .await
    .unwrap_err();
    assert_eq!(
        err,
        TextbookError::InvalidOutline("missing chapters".into())
    );
    let rows_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM imported_textbooks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows_after, 1);
}

#[tokio::test]
async fn imported_outline_overrides_builtin_and_appears_in_catalog() {
    let pool = common::setup().await;
    let builtin = resolve_textbook_outline(&pool, "数学", "人教版", "必修第一册")
        .await
        .unwrap();
    assert_eq!(builtin.chapters.len(), 4);

    let custom = r#"{
      "subject": "数学",
      "version": "人教版",
      "volume": "必修第一册",
      "chapters": [{ "name": "自定义章", "sections": ["0.1 导入"] }]
    }"#;
    import_textbook_json_impl(&pool, custom).await.unwrap();
    let resolved = resolve_textbook_outline(&pool, "数学", "人教版", "必修第一册")
        .await
        .unwrap();
    assert_eq!(resolved.chapters[0].name, "自定义章");

    let catalog = list_textbook_catalog_impl(&pool).await.unwrap();
    let math = catalog
        .iter()
        .find(|item| {
            item.subject == "数学" && item.version == "人教版" && item.volume == "必修第一册"
        })
        .unwrap();
    assert_eq!(math.source, "imported");
    assert_eq!(
        catalog
            .iter()
            .filter(|item| {
                item.subject == "数学" && item.version == "人教版" && item.volume == "必修第一册"
            })
            .count(),
        1
    );
    assert_eq!(
        catalog
            .iter()
            .find(|item| {
                item.subject == "数学" && item.version == "湘教版" && item.volume == "必修第一册"
            })
            .map(|item| item.source.as_str()),
        Some("builtin")
    );
    assert_eq!(
        catalog
            .iter()
            .find(|item| {
                item.subject == "数学" && item.version == "人教版" && item.volume == "必修第二册"
            })
            .map(|item| item.source.as_str()),
        Some("builtin")
    );
}

#[test]
fn list_available_textbooks_reads_builtin_metadata() {
    let books = list_available_textbooks().expect("builtin catalog");
    let expected = [
        ("数学", "人教版", "必修第一册"),
        ("数学", "人教版", "必修第二册"),
        ("数学", "人教版", "选择性必修第一册"),
        ("数学", "人教版", "选择性必修第二册"),
        ("数学", "人教版", "选择性必修第三册"),
        ("数学", "湘教版", "必修第一册"),
        ("数学", "湘教版", "必修第二册"),
        ("语文", "统编版", "必修上册"),
        ("语文", "统编版", "必修下册"),
        ("语文", "统编版", "选择性必修上册"),
        ("语文", "统编版", "选择性必修中册"),
        ("语文", "统编版", "选择性必修下册"),
        ("英语", "人教版", "必修第一册"),
        ("英语", "人教版", "必修第二册"),
        ("英语", "人教版", "必修第三册"),
        ("英语", "人教版", "选择性必修第一册"),
        ("英语", "人教版", "选择性必修第二册"),
        ("英语", "人教版", "选择性必修第三册"),
        ("英语", "人教版", "选择性必修第四册"),
        ("物理", "人教版", "必修第一册"),
        ("物理", "人教版", "必修第二册"),
        ("物理", "人教版", "必修第三册"),
        ("物理", "人教版", "选择性必修第一册"),
        ("物理", "人教版", "选择性必修第二册"),
        ("物理", "人教版", "选择性必修第三册"),
        ("化学", "人教版", "必修第一册"),
        ("化学", "人教版", "必修第二册"),
        ("化学", "人教版", "选择性必修第一册 化学反应原理"),
        ("化学", "人教版", "选择性必修第二册 物质结构与性质"),
        ("化学", "人教版", "选择性必修第三册 有机化学基础"),
        ("生物", "人教版", "必修1 分子与细胞"),
        ("生物", "人教版", "必修2 遗传与进化"),
        ("生物", "人教版", "选择性必修1 稳态与调节"),
        ("生物", "人教版", "选择性必修2 生物与环境"),
        ("生物", "人教版", "选择性必修3 生物技术与工程"),
    ];
    assert_eq!(books.len(), expected.len());
    for (subject, version, volume) in expected {
        assert!(
            books.iter().any(|book| {
                book.subject == subject && book.version == version && book.volume == volume
            }),
            "missing {subject} {version} {volume}"
        );
        let outline = get_textbook_outline(subject, version, volume).unwrap();
        assert!(
            outline.chapters.len() >= 3,
            "{subject} {volume} has {}",
            outline.chapters.len()
        );
        assert!(outline
            .chapters
            .iter()
            .all(|chapter| !chapter.name.is_empty() && chapter.sections.len() >= 2));
    }
}

#[tokio::test]
async fn generate_tasks_without_auto_schedule_inserts_no_sessions() {
    let pool = common::setup().await;
    let mut input = math_input("数学必修一", &["1.1 集合的概念", "2.2 基本不等式"]);
    input.auto_schedule = false;
    let result = generate_tasks_from_outline_impl(&pool, input)
        .await
        .expect("task only");
    assert_eq!(result.total_units, 15);
    assert_eq!(result.planned_count, 0);
    assert_eq!(result.done_count, 0);

    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task_sessions WHERE task_id = ?1")
        .bind(result.task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sessions, 0);
    let tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tasks, 1);
    let xp: i64 = sqlx::query_scalar("SELECT total_xp FROM user_stats WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(xp, 0);
}
