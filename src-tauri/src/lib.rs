mod commands;
mod db;
mod error;
mod gamification;
mod knowledge_graph;
mod models;
mod pdf_outline;
mod pdf_text;
mod plugins;
mod textbook_source;
mod textbooks;

pub use commands::app_settings::{get_setting_impl, set_setting_impl};
pub use commands::data::{export_json_impl, import_json_impl};
pub use commands::exams::{
    create_exam_session_impl, delete_exam_session_impl, list_exam_sessions_impl,
};
pub use commands::goals::{
    list_goals_impl, remove_goal_impl, seed_default_goal_impl, set_primary_goal_impl,
    upsert_goal_impl, DEFAULT_GOAL_DATE, DEFAULT_GOAL_NAME, GOAL_KINDS,
};
pub use commands::knowledge_graph::{
    download_plugin_knowledge_pack, downloaded_pack_exists, list_plugin_knowledge_packs,
    list_plugin_knowledge_points, list_plugin_prerequisites, list_task_prerequisite_conflicts,
    list_task_prerequisite_conflicts_impl, list_topic_mistakes, list_topic_mistakes_impl,
    KnowledgeDownloadProgress, KnowledgePackEntry, PrerequisiteConflict, PrerequisiteResult,
    CONFLICT_ORDER_SWAPPED,
    CONFLICT_PREREQUISITE_TASK_INCOMPLETE, KNOWLEDGE_PACK_DOWNLOAD_PROGRESS_EVENT,
};
pub use commands::logs::{compute_duration_min, create_log_impl};
pub use commands::mistakes::{
    create_mistake_impl, delete_mistake_impl, list_mistakes_impl, normalize_graph_link,
    normalize_reason, normalize_subject, update_mistake_impl, REASON_WHITELIST,
};
pub use commands::mock::{clear_mock_data_impl, generate_mock_data_impl, has_mock_data_impl};
pub use commands::notes::{
    create_note_impl, create_note_with_date_impl, list_notes_impl, normalize_color,
    normalize_note_date, update_note_impl, COLOR_WHITELIST,
};
pub use commands::planner::{
    ensure_today_schedule_impl, generate_week_plan_impl, EnsureTodayScheduleResult,
    GenerateWeekPlanInput, GenerateWeekPlanResult,
};
pub use commands::plugins::{
    download_plugin_textbook, install_plugin, list_plugin_options, list_plugin_textbook_catalog,
    list_plugins, read_plugin_resource, set_plugin_option, uninstall_plugin,
    PLUGIN_OPTION_DOWNLOAD_SOURCE, PLUGIN_OPTION_GITHUB_TOKEN, TEXTBOOK_DOWNLOAD_PROGRESS_EVENT,
};
pub use commands::presets::{
    apply_preset_duration_changes, apply_preset_duration_changes_impl,
    apply_preset_time_changes, apply_preset_time_changes_impl, ApplyPresetDurationChangesInput,
    ApplyPresetTimeChangesInput, DurationShiftChange, PresetDurationShiftResult, PresetShiftResult,
    TimeShiftChange,
};
pub use commands::profile::{get_user_profile_impl, update_user_profile_impl};
pub use commands::sessions::{
    complete_session_impl, create_session_impl, delete_session_impl,
    list_sessions_in_range_impl, reschedule_session_impl, test_hooks, CompleteResult,
};
pub use commands::stats::{
    stats_completion_rate_impl, stats_daily_units_impl, stats_method_share_impl,
    stats_plan_vs_actual_impl, stats_tag_type_totals_impl,
};
pub use commands::subjects::{list_subjects_impl, subject_id_for_key, subject_label};
pub use commands::tasks::{
    advance_round_impl, archive_task_impl, delete_task_impl, fetch_task_impl,
    list_deleted_tasks_impl, list_tasks_impl, purge_task_impl, restore_task_impl,
    task_progress_impl, update_task_impl,
};
pub use commands::textbook::{
    add_custom_knowledge_point_impl, add_graph_knowledge_point_impl, delete_knowledge_point_impl,
    generate_tasks_from_outline_impl, get_task_knowledge_points_impl, import_textbook_json_impl,
    import_textbook_pdf, list_textbook_catalog_impl, resolve_textbook_outline,
    toggle_knowledge_point_impl, GenerateTasksFromOutlineInput, GenerateTasksResult,
    ImportTextbookResult, TaskKnowledgePoint, TextbookCatalogItem,
};
pub use error::{AppError, SessionError, TextbookError};
pub use gamification::{update_streak_values, RESCHEDULE_RECOVERY_BONUS};
pub use knowledge_graph::{
    filter_topics, parse_dependencies, parse_packs, parse_topics, slice_dependencies_by_prefix,
    slice_topics_by_prefix, DiagnosticQuestion, KnowledgeDependenciesFile, KnowledgeDependency,
    KnowledgeGraph, KnowledgePack, KnowledgePacks, KnowledgeSourceFile, KnowledgeTopic,
    KnowledgeTopicsFile, MathLink, PrerequisiteNode, TopicFilter, KNOWLEDGE_GRAPH_LICENSE,
    STAGE_JUNIOR, STAGE_PRIMARY, STAGE_SENIOR, STAGE_UNKNOWN, STRENGTH_HARD,
};
pub use models::{
    CompleteSessionResult, CompletionRate, CreateExamSessionPayload, CreateLogPayload,
    CreateMistakePayload, DailyUnitsRow, ExamScore, ExamScoreInput, ExamSession,
    ExamSessionWithScores, Goal, MethodShareRow, Mistake, PlanVsActualRow, RemainderSchedule,
    Subject, SubjectTargets, TagTypeRow, Task, TaskProgress, TaskSession, TopicMistake,
    TopicMistakes, UpdateMistakePayload, UpdateNotePayload, UpdateTaskPayload,
    UpsertGoalPayload, UserProfile,
};
pub use pdf_outline::{
    extract_outline, extract_outline_lines, inspect_pdf_pages, outline_to_textbook,
    parse_outline_lines, OutlineChapter, OutlineSection,
};
pub use plugins::{
    builtin_package, builtin_packages, builtin_plugin_resources, install_plugin_impl,
    list_plugins_impl, plugin_option_key, plugin_options_impl, plugin_resource_text,
    set_plugin_option_impl, uninstall_plugin_impl, PluginInfo, PluginOption, PluginOptionValue,
    PluginPackage, PluginResource, INSTALLED_PLUGINS_KEY, PLUGIN_RESOURCES_DIR,
    PLUGIN_RESOURCE_KIND_FILE, PLUGIN_RESOURCE_KIND_KNOWLEDGE_GRAPH,
    PLUGIN_RESOURCE_KIND_TEXTBOOK_CATALOG,
};
pub use textbook_source::{
    download_error_message, download_textbook, encode_repo_path, parse_textbook_catalog,
    safe_file_name, textbook_download_plan, textbook_download_requests, textbook_download_urls,
    textbooks_dir, CatalogShard, CatalogStage, CatalogTextbook, DownloadCandidate, DownloadProgress,
    DownloadRequest, DownloadRetryPolicy, DownloadShardPlan, DownloadSource, DownloadedTextbook,
    GITHUB_BLOB_ACCEPT, TextbookCatalog,
};
pub use textbooks::parse_textbook_json;
pub use textbooks::{
    get_textbook_outline, list_available_textbooks, AvailableTextbook, TextbookChapter,
    TextbookOutline, TextbookSection,
};

use db::{db_path, open_db, open_sqlx_pool, AppPrefs, DbState};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let path = db_path(app.handle())?;
            db::backup_db_file(&path, chrono::Local::now())?;
            let pool = tauri::async_runtime::block_on(open_sqlx_pool(&path))?;
            let conn = open_db(&path)?;
            // 目标落库后第一次启动：空库时补一条默认目标，和以前 localStorage 里的兜底一致。
            seed_default_goal_impl(&conn)?;
            app.manage(pool);
            app.manage(DbState(Mutex::new(conn)));
            app.manage(AppPrefs::new());

            let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出 TimeQuest", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("TimeQuest · 目标倒计时")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    let close_to_tray = window
                        .app_handle()
                        .try_state::<AppPrefs>()
                        .map(|p| p.close_to_tray())
                        .unwrap_or(true);
                    if close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                // The widget is created at startup (hidden). If it stayed open
                // after main was destroyed, the process would keep running with
                // no taskbar window. Tray-hide does not destroy main, so the
                // widget can stay up while the app is still in the tray.
                WindowEvent::Destroyed => {
                    if window.label() == "main" {
                        if let Some(widget) = window.app_handle().get_webview_window("widget") {
                            let _ = widget.close();
                        }
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_tasks,
            commands::get_task,
            commands::create_task,
            commands::update_task,
            commands::archive_task,
            commands::delete_task,
            commands::list_deleted_tasks,
            commands::restore_task,
            commands::purge_task,
            commands::advance_round,
            commands::task_progress,
            commands::get_textbook_outline,
            commands::list_available_textbooks,
            commands::list_textbook_catalog,
            commands::import_textbook_json,
            commands::import_textbook_pdf,
            commands::generate_tasks_from_outline,
            commands::get_task_knowledge_points,
            commands::toggle_knowledge_point,
            commands::add_custom_knowledge_point,
            commands::delete_knowledge_point,
            commands::list_sessions_by_date,
            commands::list_sessions_in_range,
            commands::list_sessions_by_task,
            commands::create_session,
            commands::delete_session,
            commands::generate_week_plan,
            commands::ensure_today_schedule,
            commands::find_overlaps,
            commands::apply_preset_time_changes,
            commands::apply_preset_duration_changes,
            commands::complete_session,
            commands::reschedule_session,
            commands::create_log,
            commands::list_logs,
            commands::list_notes,
            commands::create_note,
            commands::update_note,
            commands::delete_note,
            commands::list_plugins,
            commands::install_plugin,
            commands::uninstall_plugin,
            commands::list_plugin_options,
            commands::set_plugin_option,
            commands::read_plugin_resource,
            commands::list_plugin_textbook_catalog,
            commands::download_plugin_textbook,
            commands::list_plugin_knowledge_packs,
            commands::list_plugin_knowledge_points,
            commands::list_plugin_prerequisites,
            commands::list_task_prerequisite_conflicts,
            commands::list_topic_mistakes,
            commands::download_plugin_knowledge_pack,
            commands::list_mistakes,
            commands::create_mistake,
            commands::update_mistake,
            commands::delete_mistake,
            commands::get_user_stats,
            commands::list_user_achievements,
            commands::stats_plan_vs_actual,
            commands::stats_method_share,
            commands::stats_tag_type_totals,
            commands::stats_completion_rate,
            commands::stats_daily_units,
            commands::stats_avg_ratings,
            commands::export_json,
            commands::import_json,
            commands::get_setting,
            commands::set_setting,
            commands::get_user_profile,
            commands::update_user_profile,
            commands::list_subjects,
            commands::create_exam_session,
            commands::list_exam_sessions,
            commands::delete_exam_session,
            commands::list_goals,
            commands::upsert_goal,
            commands::remove_goal,
            commands::set_primary_goal,
            commands::has_mock_data,
            commands::generate_mock_data,
            commands::clear_mock_data,
            commands::get_db_path,
            commands::set_close_to_tray,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TimeQuest");
}
