import { invoke } from "@tauri-apps/api/core";
import type {
  ActualLog,
  ApplyPresetDurationChangesInput,
  ApplyPresetTimeChangesInput,
  AvgRatingRow,
  CompleteSessionInput,
  CompleteSessionResult,
  CreateExamSessionPayload,
  DownloadedTextbook,
  ExamSession,
  CompletionRate,
  EnsureTodayScheduleResult,
  Goal,
  MethodShareRow,
  Note,
  DailyUnitsRow,
  AvailableTextbook,
  GenerateTasksFromOutlineInput,
  GenerateTasksResult,
  GenerateWeekPlanInput,
  GenerateWeekPlanResult,
  ImportTextbookResult,
  KnowledgePack,
  KnowledgePackEntry,
  KnowledgeTopic,
  Mistake,
  PlanVsActualRow,
  PluginInfo,
  PluginOptionValue,
  PresetDurationShiftResult,
  PresetShiftResult,
  PrerequisiteConflict,
  PrerequisiteResult,
  RescheduleInput,
  Subject,
  TagTypeRow,
  Task,
  TaskKnowledgePoint,
  TaskSession,
  TextbookCatalog,
  TextbookCatalogItem,
  TextbookOutline,
  TopicMistakes,
  Track,
  UpdateMistakePayload,
  UpsertGoalPayload,
  UpsertSubjectPayload,
  UpsertTrackPayload,
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
  deleteTask: (id: number) => invoke<void>("delete_task", { id }),
  listDeletedTasks: () => invoke<Task[]>("list_deleted_tasks"),
  restoreTask: (id: number) => invoke<void>("restore_task", { id }),
  purgeTask: (id: number) => invoke<void>("purge_task", { id }),
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
  addCustomKnowledgePoint: (
    taskId: number,
    sectionName: string,
    name: string,
    graph?: { topicId: string; subject?: string | null },
  ) => {
    // 没给图谱来源就传 null，后端就知道这是自写 / 教材考点。
    const topicId = graph?.topicId?.trim() ?? "";
    return invoke<TaskKnowledgePoint>("add_custom_knowledge_point", {
      taskId,
      sectionName,
      name,
      graphTopicId: topicId ? topicId : null,
      graphSubject: topicId ? (graph?.subject ?? null) : null,
    });
  },
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
  /** 启动时补排今天；今天已经有安排就什么都不做（幂等）。 */
  ensureTodaySchedule: () =>
    invoke<EnsureTodayScheduleResult>("ensure_today_schedule"),
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
  /** 常用时段改时间后，把已排的场次批量挪到新时段。 */
  applyPresetTimeChanges: (input: ApplyPresetTimeChangesInput) =>
    invoke<PresetShiftResult>("apply_preset_time_changes", { input }),
  /** 常用时长改分钟数后，把已排的场次批量改到新时长。 */
  applyPresetDurationChanges: (input: ApplyPresetDurationChangesInput) =>
    invoke<PresetDurationShiftResult>("apply_preset_duration_changes", { input }),

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
    /** 上游知识点 id（知识图谱）。不挂知识点就传 null。 */
    graphTopicId?: string | null;
    /** 图谱学科代号。 */
    graphSubject?: string | null;
    /** 知识点名字。 */
    graphTopicName?: string | null;
  }) =>
    invoke<Mistake>("create_mistake", {
      payload: {
        subject: payload.subject,
        title: payload.title,
        reason: payload.reason,
        correctNote: payload.correctNote,
        graphTopicId: payload.graphTopicId ?? null,
        graphSubject: payload.graphSubject ?? null,
        graphTopicName: payload.graphTopicName ?? null,
      },
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
  readPluginMotivationPack: (pluginId: string) =>
    invoke<string>("read_plugin_motivation_pack", { pluginId }),
  downloadPluginTextbook: (pluginId: string, path: string) =>
    invoke<DownloadedTextbook>("download_plugin_textbook", { pluginId, path }),

  // knowledge graph (toolbox)
  listPluginKnowledgePacks: (pluginId: string) =>
    invoke<KnowledgePackEntry[]>("list_plugin_knowledge_packs", { pluginId }),
  listPluginKnowledgePoints: (
    pluginId: string,
    subject: string,
    stage?: string | null,
    query?: string | null,
  ) =>
    invoke<KnowledgeTopic[]>("list_plugin_knowledge_points", {
      pluginId,
      subject,
      stage: stage ?? null,
      query: query ?? null,
    }),
  listPluginPrerequisites: (pluginId: string, subject: string, topicId: string) =>
    invoke<PrerequisiteResult>("list_plugin_prerequisites", { pluginId, subject, topicId }),
  listTaskPrerequisiteConflicts: (pluginId: string, taskId: number) =>
    invoke<PrerequisiteConflict[]>("list_task_prerequisite_conflicts", { pluginId, taskId }),
  listTopicMistakes: (pluginId: string, subject: string, topicId: string) =>
    invoke<TopicMistakes>("list_topic_mistakes", { pluginId, subject, topicId }),
  downloadPluginKnowledgePack: (pluginId: string, subject: string) =>
    invoke<KnowledgePack>("download_plugin_knowledge_pack", { pluginId, subject }),

  // gamification / user
  getUserStats: () => invoke<UserStats>("get_user_stats"),
  getUserProfile: () => invoke<UserProfile>("get_user_profile"),
  updateUserProfile: (profile: UserProfile) =>
    invoke<UserProfile>("update_user_profile", { profile }),
  listSubjects: (trackId?: number | null) =>
    invoke<Subject[]>("list_subjects", { trackId: trackId ?? null }),
  upsertSubject: (payload: UpsertSubjectPayload) =>
    invoke<Subject>("upsert_subject", { payload }),
  removeSubject: (id: number) => invoke<void>("remove_subject", { id }),
  listTracks: () => invoke<Track[]>("list_tracks"),
  upsertTrack: (payload: UpsertTrackPayload) =>
    invoke<Track>("upsert_track", { payload }),
  removeTrack: (id: number) => invoke<void>("remove_track", { id }),
  listExamSessions: () => invoke<ExamSession[]>("list_exam_sessions"),
  createExamSession: (payload: CreateExamSessionPayload) =>
    invoke<ExamSession>("create_exam_session", { payload }),
  deleteExamSession: (id: number) => invoke<void>("delete_exam_session", { id }),

  // goals (countdown targets)
  listGoals: () => invoke<Goal[]>("list_goals"),
  upsertGoal: (payload: UpsertGoalPayload) =>
    invoke<Goal>("upsert_goal", { payload }),
  removeGoal: (id: number) => invoke<void>("remove_goal", { id }),
  setPrimaryGoal: (id: number) => invoke<void>("set_primary_goal", { id }),
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
