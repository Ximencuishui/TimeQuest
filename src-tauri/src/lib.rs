mod commands;
mod db;
mod error;
mod gamification;
mod models;
mod textbooks;

pub use commands::app_settings::{get_setting_impl, set_setting_impl};
pub use commands::data::{export_json_impl, import_json_impl};
pub use commands::exams::{
    create_exam_record_impl, delete_exam_record_impl, list_exam_records_impl,
};
pub use commands::logs::{compute_duration_min, create_log_impl};
pub use commands::mock::{clear_mock_data_impl, generate_mock_data_impl, has_mock_data_impl};
pub use commands::notes::{
    create_note_impl, list_notes_impl, normalize_color, update_note_impl, COLOR_WHITELIST,
};
pub use commands::profile::{get_user_profile_impl, update_user_profile_impl};
pub use commands::sessions::{
    complete_session_impl, create_session_impl, list_sessions_in_range_impl,
    reschedule_session_impl, test_hooks, CompleteResult,
};
pub use commands::stats::{
    stats_completion_rate_impl, stats_daily_units_impl, stats_method_share_impl,
    stats_plan_vs_actual_impl, stats_tag_type_totals_impl,
};
pub use commands::tasks::{advance_round_impl, task_progress_impl};
pub use commands::textbook::{
    generate_tasks_from_outline_impl, import_textbook_json_impl, list_textbook_catalog_impl,
    resolve_textbook_outline, GenerateTasksFromOutlineInput, GenerateTasksResult,
    ImportTextbookResult, TextbookCatalogItem,
};
pub use error::{AppError, SessionError, TextbookError};
pub use gamification::{update_streak_values, RESCHEDULE_RECOVERY_BONUS};
pub use models::{
    CompleteSessionResult, CompletionRate, CreateExamRecordPayload, CreateLogPayload,
    DailyUnitsRow, ExamRecord, MethodShareRow, PlanVsActualRow, RemainderSchedule, SubjectTargets,
    TagTypeRow, Task, TaskProgress, TaskSession, UpdateNotePayload, UserProfile,
};
pub use textbooks::parse_textbook_json;
pub use textbooks::{
    get_textbook_outline, list_available_textbooks, AvailableTextbook, TextbookChapter,
    TextbookOutline,
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
            app.manage(pool);
            app.manage(DbState(Mutex::new(conn)));
            app.manage(AppPrefs::new());

            let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出 TimeQuest", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("TimeQuest · 高考倒计时")
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
            commands::advance_round,
            commands::task_progress,
            commands::get_textbook_outline,
            commands::list_available_textbooks,
            commands::list_textbook_catalog,
            commands::import_textbook_json,
            commands::generate_tasks_from_outline,
            commands::list_sessions_by_date,
            commands::list_sessions_in_range,
            commands::list_sessions_by_task,
            commands::create_session,
            commands::find_overlaps,
            commands::complete_session,
            commands::reschedule_session,
            commands::create_log,
            commands::list_logs,
            commands::list_notes,
            commands::create_note,
            commands::update_note,
            commands::delete_note,
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
            commands::create_exam_record,
            commands::list_exam_records,
            commands::delete_exam_record,
            commands::has_mock_data,
            commands::generate_mock_data,
            commands::clear_mock_data,
            commands::get_db_path,
            commands::set_close_to_tray,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TimeQuest");
}
