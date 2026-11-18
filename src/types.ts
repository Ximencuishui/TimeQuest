export type TaskType = "main" | "side";
export type SessionStatus = "planned" | "done" | "missed" | "rescheduled";
export type TagType = "study" | "sport" | "game" | "other";

export type Task = {
  id: number;
  title: string;
  type: TaskType;
  subject: string | null;
  textbook: string | null;
  unit_name: string;
  total_units: number | null;
  total_rounds: number;
  current_round: number;
  color: string | null;
  archived: number;
  created_at: string;
  actual_units_sum?: number;
};

export type TaskSession = {
  id: number;
  task_id: number;
  date: string;
  start_time: string;
  end_time: string;
  round: number;
  status: SessionStatus;
  planned_units: number;
  actual_units: number;
  self_rating: number | null;
  self_note: string | null;
  rescheduled_to: number | null;
  xp_awarded: number;
  created_at: string;
  task_title?: string;
  task_type?: TaskType;
  task_color?: string | null;
  subject?: string | null;
  /** 任务的单位名（"课" / "节"），用来把「计划 2」说成「计划 2 节」。 */
  task_unit_name?: string | null;
};

export type ActualLog = {
  id: number;
  date: string;
  start_at: string | null;
  end_at: string | null;
  duration_min: number;
  subject: string | null;
  method: string | null;
  tag_type: TagType;
  session_id: number | null;
  note: string | null;
  created_at: string;
};

export type Note = {
  id: number;
  content: string;
  color: string;
  pinned: number;
  /** 绑定的日期（`YYYY-MM-DD`）；没绑定就是 null。 */
  note_date: string | null;
  created_at: string;
  updated_at: string;
};

export type Mistake = {
  id: number;
  /** 科目，空串表示还没归类。 */
  subject: string;
  /** 题目 / 知识点的简述。 */
  title: string;
  /** 错因分类，见 `MISTAKE_REASONS`。 */
  reason: string;
  /** 自己写下的正确思路，可空。 */
  correct_note: string;
  /** 1 = 已订正。 */
  is_mastered: number;
  created_at: string;
  updated_at: string;
};

/** 更新错题的请求体，字段名与 Rust `UpdateMistakePayload` 的 camelCase 一致。 */
export type UpdateMistakePayload = {
  subject?: string;
  title?: string;
  reason?: string;
  correctNote?: string;
  /** 0 = 未订正，1 = 已订正。 */
  isMastered?: number;
};

/** 插件的一个可配置项。 */
export type PluginOption = {
  key: string;
  label: string;
  /** `text` / `number` / `bool` / `select`，前端按它选输入控件。 */
  kind: string;
  default: string;
  /** `select` 类型的候选项；其他类型忽略。 */
  choices?: string[];
  /** `select` 候选项的显示文案：候选值 -> 显示给用户的名字。 */
  choice_labels?: Record<string, string>;
  /** 说明文字，显示在选项下面，写给普通用户看。 */
  help?: string;
  /** 高级选项：收进折叠区，默认不展开。 */
  advanced?: boolean;
  /** 敏感内容（令牌、口令）：用密码框渲染，不明文回显。 */
  secret?: boolean;
};

/** 插件自带的一个资源文件。 */
export type PluginResource = {
  path: string;
  /** `file`（默认）或 `textbook_catalog`（教材清单）。 */
  kind: string;
  description: string;
};

/** 工具箱里的一个插件。 */
export type PluginInfo = {
  id: string;
  name: string;
  summary: string;
  author: string;
  version: string;
  /** 工具箱网格里的图标（emoji 或短字符）。 */
  icon: string;
  size_kb: number;
  /** 装上之后多出来的能力。 */
  capabilities: string[];
  options: PluginOption[];
  /** 插件自带的资源文件，教材清单就靠它认。 */
  resources?: PluginResource[];
  installed: boolean;
};

/** 插件选项的当前值：没设置过就用包里的默认值。 */
export type PluginOptionValue = {
  key: string;
  label: string;
  kind: string;
  value: string;
};

/** 教材清单里的一个学段。 */
export type CatalogStage = {
  label: string;
  count: number;
};

/** 教材清单里的一个分片。 */
export type CatalogShard = {
  index: number;
  size: number;
  sha: string;
};

/** 教材清单里的一本书。 */
export type CatalogTextbook = {
  /** 仓库里的相对路径，也是下载时定位这本书的钥匙。 */
  path: string;
  title: string;
  /** 原始学段名，可能是 `小学（五•四学制）` 这种带括号的。 */
  stage: string;
  /** 归一化后的学段：`小学` / `初中` / `高中` / `大学` / `其他`。 */
  stageKey: string;
  subject: string;
  /** 教材版本，例如 `人教版-人民教育出版社`。 */
  edition?: string | null;
  /** 年级册次，例如 `七年级`；有些书没有这一层。 */
  grade?: string | null;
  /** 文件总字节数。 */
  size: number;
  /** 分片数。`1` 表示仓库里就是完整的一个 PDF。 */
  parts: number;
  shards: CatalogShard[];
};

/** 一份教材清单快照。 */
export type TextbookCatalog = {
  source: string;
  /** 仓库全名，形式 `owner/repo`。 */
  repo: string;
  /** 原始文件下载前缀。 */
  rawBase: string;
  /** 清单对应的仓库提交，下载时用它锁定内容。 */
  commit: string;
  generatedAt: string;
  count: number;
  stages: CatalogStage[];
  textbooks: CatalogTextbook[];
};

/** 教材下载进度。 */
export type TextbookDownloadProgress = {
  path: string;
  /** 已经落盘的字节数。 */
  downloaded: number;
  /** 这本书的总字节数；清单没写时是 0。 */
  total: number;
  /** 当前在第几个分片，从 1 开始。 */
  part: number;
  /** 总分片数。 */
  parts: number;
  /** 第几次尝试，从 1 开始；断了重传会变大于 1。 */
  attempt?: number;
};

/** 下载完成的教材。 */
export type DownloadedTextbook = {
  /** 落在磁盘上的完整 PDF 路径。 */
  file: string;
  bytes: number;
};

export type SubjectTargets = {
  chinese: number;
  math: number;
  english: number;
  physics: number;
  chemistry: number;
  biology: number;
};

export type UserProfile = {
  avatar: string | null;
  grade: string;
  region: string;
  total_target: number;
  subject_targets: SubjectTargets;
};

export type ExamRecord = {
  id: number;
  exam_name: string;
  exam_date: string;
  chinese_score: number | null;
  math_score: number | null;
  english_score: number | null;
  physics_score: number | null;
  chemistry_score: number | null;
  biology_score: number | null;
  created_at: string;
};

export type CreateExamRecordPayload = {
  exam_name: string;
  exam_date: string;
  chinese_score: number | null;
  math_score: number | null;
  english_score: number | null;
  physics_score: number | null;
  chemistry_score: number | null;
  biology_score: number | null;
};

export type UserStats = {
  id: number;
  total_xp: number;
  current_level: number;
  current_streak: number;
  longest_streak: number;
  last_done_date: string | null;
};

export type Achievement = {
  id: string;
  name: string;
  description: string;
};

export type UserAchievement = {
  achievement_id: string;
  unlocked_at: string;
  name?: string;
  description?: string;
};

export type ExamTarget = {
  id: string;
  name: string;
  date: string;
  isPrimary: boolean;
};

export type PlanVsActualRow = {
  subject: string;
  planned_min: number;
  actual_min: number;
};

export type MethodShareRow = {
  method: string;
  duration_min: number;
};

export type TagTypeRow = {
  tag_type: string;
  duration_min: number;
};

export type CompletionRate = {
  done: number;
  missed: number;
  rescheduled: number;
  rate: number;
};

export type AvgRatingRow = {
  key: string;
  avg_rating: number;
  count: number;
};

export type DailyUnitsRow = {
  date: string;
  units: number;
};

export type CompleteSessionInput = {
  sessionId: number;
  actualUnits: number;
  selfRating: number;
  selfNote?: string | null;
  method?: string | null;
  deferRemaining?: boolean;
  deferDate?: string | null;
  deferStart?: string | null;
  deferEnd?: string | null;
};

export type RescheduleInput = {
  sessionId: number;
  date: string;
  startTime: string;
  endTime: string;
};

export type CompleteSessionResult = {
  session: TaskSession;
  xpAwarded: number;
  newAchievements: string[];
  createdSessionId: number | null;
  remainderSessionId: number | null;
  /** 这次完成让主线当前轮从低于 total_units 跨到达到或超过。 */
  isTaskFullyCompleted?: boolean;
  /** 完成后的 current_streak。0 单位或幂等完成时是库里的原值。 */
  currentStreak?: number;
  /** 7 / 14 / 30，且这次完成刚把连击推进到这个数字。同日再完成是 null。 */
  streakMilestone?: number | null;
};

export type TaskKnowledgePoint = {
  id: number;
  task_id: number;
  section_name: string;
  name: string;
  is_mastered: number;
  position: number;
};

export type TextbookSection = {
  name: string;
  knowledge_points?: string[];
};

export type TextbookChapter = {
  name: string;
  sections: TextbookSection[];
};

export type TextbookOutline = {
  subject: string;
  version: string;
  volume: string;
  chapters: TextbookChapter[];
};

export type GenerateTasksFromOutlineInput = {
  subject: string;
  version: string;
  volume: string;
  taskName: string;
  selectedSections: string[];
  autoSchedule: boolean;
};

export type AvailableTextbook = {
  subject: string;
  version: string;
  volume: string;
};

export type GenerateTasksResult = {
  taskId: number;
  totalUnits: number;
  plannedCount: number;
  doneCount: number;
  /** 排期铺到的最后一天（`YYYY-MM-DD`）；没有待学排期时为空。 */
  lastPlannedDate: string | null;
};

export type ImportTextbookResult = {
  outline: TextbookOutline;
  replaced: boolean;
};

export type GenerateWeekPlanInput = {
  taskId: number;
  /** 起始日期（`YYYY-MM-DD`）；不填就是今天。 */
  startDate?: string | null;
  /** 排几天；不填就是 7 天。 */
  days?: number | null;
};

export type GenerateWeekPlanResult = {
  taskId: number;
  /** 实际新建的排期数。 */
  created: number;
  /** 因为时段被占用或超过每日上限而跳过的格子数。 */
  skipped: number;
  /** 排到的最后一天（`YYYY-MM-DD`）。 */
  lastDate: string | null;
};

export type TextbookCatalogItem = {
  subject: string;
  version: string;
  volume: string;
  source: string;
};
