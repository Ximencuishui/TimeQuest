import { invoke } from "@tauri-apps/api/core";
import type {
  ActualLog,
  AvgRatingRow,
  CompleteSessionInput,
  CompleteSessionResult,
  CreateExamRecordPayload,
  ExamRecord,
  CompletionRate,
  MethodShareRow,
  Note,
  DailyUnitsRow,
  AvailableTextbook,
  GenerateTasksFromOutlineInput,
  GenerateTasksResult,
  ImportTextbookResult,
  PlanVsActualRow,
  RescheduleInput,
  TagTypeRow,
  Task,
  TaskKnowledgePoint,
  TaskSession,
  TextbookCatalogItem,
  TextbookOutline,
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
  createNote: (content: string, color: string) =>
    invoke<Note>("create_note", { content, color }),
  updateNote: (
    id: number,
    payload: { content?: string; color?: string; pinned?: boolean },
  ) => invoke<Note>("update_note", { id, payload }),
  deleteNote: (id: number) => invoke<void>("delete_note", { id }),

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
