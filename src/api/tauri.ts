import { invoke } from "@tauri-apps/api/core";
import type {
  ActualLog,
  AvgRatingRow,
  CompleteSessionInput,
  CompleteSessionResult,
  CreateExamRecordPayload,
  DownloadedTextbook,
  ExamRecord,
  CompletionRate,
  MethodShareRow,
  Note,
  DailyUnitsRow,
  AvailableTextbook,
  GenerateTasksFromOutlineInput,
  GenerateTasksResult,
  GenerateWeekPlanInput,
  GenerateWeekPlanResult,
  ImportTextbookResult,
  Mistake,
  PlanVsActualRow,
  PluginInfo,
  PluginOptionValue,
  RescheduleInput,
  TagTypeRow,
  Task,
  TaskKnowledgePoint,
  TaskSession,
  TextbookCatalog,
  TextbookCatalogItem,
  TextbookOutline,
  UpdateMistakePayload,
  UserAchievement,
  UserProfile,
  UserStats,
} from "../types";

export const api = {
  // tasks
  listTasks: (includeArchived = false) =>
    invoke<Task[]>("list_tasks", { includeArchived }),
  getTask: (id: number) => invoke<Task>("get_task", { id }),
  createTask: (payload: Partial<Task> & { title: string; type: string }) =>
    invoke<Task>("create_task", { payload }),
  updateTask: (id: number, payload: Partial<Task>) =>
    invoke<Task>("update_task", { id, payload }),
  archiveTask: (id: number, archived: boolean) =>
    invoke<void>("archive_task", { id, archived }),
  advanceRound: (id: number) => invoke<Task>("advance_round", { id }),
  taskProgress: (id: number) =>
    invoke<{ round_units: number; total_units_done: number }>("task_progress", {
      id,
    }),
  getTextbookOutline: (subject: string, version: string, volume: string) =>
    invoke<TextbookOutline>("get_textbook_outline", { subject, version, volume }),
  listAvailableTextbooks: () =>
    invoke<AvailableTextbook[]>("list_available_textbooks"),
  listTextbookCatalog: () => invoke<TextbookCatalogItem[]>("list_textbook_catalog"),
  importTextbookJson: (json: string) =>
    invoke<ImportTextbookResult>("import_textbook_json", { json }),
  importTextbookPdf: (
    file: string,
    subject: string,
    version: string,
    volume: string,
  ) =>
    invoke<ImportTextbookResult>("import_textbook_pdf", {
      file,
      subject,
      version,
      volume,
    }),
  getTaskKnowledgePoints: (taskId: number) =>
    invoke<TaskKnowledgePoint[]>("get_task_knowledge_points", { taskId }),
  toggleKnowledgePoint: (id: number) =>
    invoke<TaskKnowledgePoint>("toggle_knowledge_point", { id }),
  addCustomKnowledgePoint: (taskId: number, sectionName: string, name: string) =>
    invoke<TaskKnowledgePoint>("add_custom_knowledge_point", {
      taskId,
      sectionName,
      name,
    }),
  deleteKnowledgePoint: (id: number) =>
    invoke<void>("delete_knowledge_point", { id }),
  generateTasksFromOutline: (input: GenerateTasksFromOutlineInput) =>
    invoke<GenerateTasksResult>("generate_tasks_from_outline", {
      subject: input.subject,
      version: input.version,
      volume: input.volume,
      taskName: input.taskName,
      selectedSections: input.selectedSections,
      autoSchedule: input.autoSchedule,
    }),

  // sessions
  listSessionsByDate: (date: string) =>
    invoke<TaskSession[]>("list_sessions_by_date", { date }),
  listSessionsInRange: (startDate: string, endDate: string) =>
    invoke<TaskSession[]>("list_sessions_in_range", { startDate, endDate }),
  listSessionsByTask: (taskId: number) =>
    invoke<TaskSession[]>("list_sessions_by_task", { taskId }),
  createSession: (payload: {
    taskId: number;
    date: string;
    startTime: string;
    endTime: string;
    round?: number;
    plannedUnits?: number;
  }) => invoke<TaskSession>("create_session", { payload }),
  deleteSession: (sessionId: number) => invoke<void>("delete_session", { sessionId }),
  generateWeekPlan: (input: GenerateWeekPlanInput) =>
    invoke<GenerateWeekPlanResult>("generate_week_plan", { input }),
  completeSession: (input: CompleteSessionInput) =>
    invoke<CompleteSessionResult>("complete_session", { input }),
  rescheduleSession: (input: RescheduleInput) =>
    invoke<CompleteSessionResult>("reschedule_session", { input }),
  findOverlaps: (date: string, startTime: string, endTime: string, excludeId?: number) =>
    invoke<TaskSession[]>("find_overlaps", {
      date,
      startTime,
      endTime,
      excludeId: excludeId ?? null,
    }),

  // logs
  createLog: (payload: {
    date: string;
    startAt?: string | null;
    endAt?: string | null;
    durationMin?: number | null;
    subject?: string | null;
    method?: string | null;
    tagType?: string;
    note?: string | null;
  }) => invoke<ActualLog>("create_log", { payload }),
  listLogs: (from: string, to: string) =>
    invoke<ActualLog[]>("list_logs", { from, to }),

  // stats
  planVsActual: (from: string, to: string) =>
    invoke<PlanVsActualRow[]>("stats_plan_vs_actual", { from, to }),
  methodShare: (from: string, to: string) =>
    invoke<MethodShareRow[]>("stats_method_share", { from, to }),
  tagTypeTotals: (from: string, to: string) =>
    invoke<TagTypeRow[]>("stats_tag_type_totals", { from, to }),
  completionRate: (from: string, to: string) =>
    invoke<CompletionRate>("stats_completion_rate", { from, to }),
  avgRatings: (from: string, to: string) =>
    invoke<AvgRatingRow[]>("stats_avg_ratings", { from, to }),
  dailyUnits: (from: string, to: string) =>
    invoke<DailyUnitsRow[]>("stats_daily_units", { from, to }),

  // notes
  listNotes: () => invoke<Note[]>("list_notes"),
  createNote: (content: string, color: string, noteDate?: string | null) =>
    invoke<Note>("create_note", { content, color, noteDate: noteDate ?? null }),
  updateNote: (
    id: number,
    payload: {
      content?: string;
      color?: string;
      pinned?: boolean;
      /** 空串 = 取消绑定日期。 */
      noteDate?: string;
    },
  ) => invoke<Note>("update_note", { id, payload }),
  deleteNote: (id: number) => invoke<void>("delete_note", { id }),

  // mistakes
  listMistakes: () => invoke<Mistake[]>("list_mistakes"),
  createMistake: (payload: {
    subject: string;
    title: string;
    reason: string;
    correctNote: string;
  }) =>
    invoke<Mistake>("create_mistake", {
      subject: payload.subject,
      title: payload.title,
      reason: payload.reason,
      correctNote: payload.correctNote,
    }),
  updateMistake: (id: number, payload: UpdateMistakePayload) =>
    invoke<Mistake>("update_mistake", { id, payload }),
  deleteMistake: (id: number) => invoke<void>("delete_mistake", { id }),

  // plugins (toolbox)
  listPlugins: () => invoke<PluginInfo[]>("list_plugins"),
  installPlugin: (id: string) => invoke<PluginInfo>("install_plugin", { id }),
  uninstallPlugin: (id: string) => invoke<void>("uninstall_plugin", { id }),
  listPluginOptions: (pluginId: string) =>
    invoke<PluginOptionValue[]>("list_plugin_options", { pluginId }),
  setPluginOption: (pluginId: string, key: string, value: string) =>
    invoke<void>("set_plugin_option", { pluginId, key, value }),
  listPluginTextbookCatalog: (pluginId: string) =>
    invoke<TextbookCatalog>("list_plugin_textbook_catalog", { pluginId }),
  downloadPluginTextbook: (pluginId: string, path: string) =>
    invoke<DownloadedTextbook>("download_plugin_textbook", { pluginId, path }),

  // gamification / user
  getUserStats: () => invoke<UserStats>("get_user_stats"),
  getUserProfile: () => invoke<UserProfile>("get_user_profile"),
  updateUserProfile: (profile: UserProfile) =>
    invoke<UserProfile>("update_user_profile", { profile }),
  listExamRecords: () => invoke<ExamRecord[]>("list_exam_records"),
  createExamRecord: (payload: CreateExamRecordPayload) =>
    invoke<ExamRecord>("create_exam_record", { payload }),
  deleteExamRecord: (id: number) => invoke<void>("delete_exam_record", { id }),
  listAchievements: () => invoke<UserAchievement[]>("list_user_achievements"),

  // data
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),

  generateMockData: () => invoke<void>("generate_mock_data"),
  clearMockData: () => invoke<void>("clear_mock_data"),
  hasMockData: () => invoke<boolean>("has_mock_data"),

  exportJson: () => invoke<string>("export_json"),
  importJson: (json: string) => invoke<void>("import_json", { json }),
  getDbPath: () => invoke<string>("get_db_path"),
  setCloseToTray: (enabled: boolean) =>
    invoke<void>("set_close_to_tray", { enabled }),
};
