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
  /** 移入回收站的时间戳；非空表示任务已被删除，可在回收站里找回。 */
  deleted_at?: string | null;
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
  /** 上游知识点 id（知识图谱），比如 `cnm_001`。没挂知识点的错题没有。 */
  graph_topic_id: string | null;
  /** 图谱学科代号，比如 `math`。没挂知识点的错题没有。 */
  graph_subject: string | null;
  /** 知识点的名字。错题列表靠它显示标签，不用再拉整包图谱。 */
  graph_topic_name: string | null;
  created_at: string;
  updated_at: string;
};

/** 挂在某个图谱知识点上的一条错题。 */
export type TopicMistake = {
  id: number;
  subject: string;
  title: string;
  reason: string;
  correct_note: string;
  /** 1 = 已订正。 */
  is_mastered: number;
  created_at: string;
};

/** 某个知识点上的错题汇总。 */
export type TopicMistakes = {
  topic_id: string;
  /** 图谱里的知识点名。图谱读不到时是空串。 */
  topic_name: string;
  /** 错题总数。 */
  total: number;
  /** 还没订正的条数。 */
  pending: number;
  items: TopicMistake[];
};

/** 更新错题的请求体，字段名与 Rust `UpdateMistakePayload` 的 camelCase 一致。 */
export type UpdateMistakePayload = {
  subject?: string;
  title?: string;
  reason?: string;
  correctNote?: string;
  /** 0 = 未订正，1 = 已订正。 */
  isMastered?: number;
  /** 上游知识点 id（知识图谱）。 */
  graphTopicId?: string | null;
  /** 图谱学科代号。 */
  graphSubject?: string | null;
  /** 知识点名字。 */
  graphTopicName?: string | null;
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

/**
 * 科目字典的一行。
 *
 * 4.0 起科目集合落在 SQLite 的 `subjects` 表，不再写死六科。
 */
export type Subject = {
  id: number;
  /** 稳定标识，如 `chinese` / `math`。 */
  key: string;
  /** 显示名，如「语文」。 */
  label: string;
  /** 满分，可空（这条赛道没固定满分时可以不填）。 */
  fullMark: number | null;
  /** 目标分，可空。 */
  goal: number | null;
  /** 单位，如「分」。 */
  unit: string | null;
  /** 排序序号，越小越靠前。 */
  orderIndex: number;
};

/** 一条成绩行：一次考试里的一科。 */
export type ExamScore = {
  id: number;
  examId: number;
  subjectId: number;
  /** 分数。`null` 表示这场没考这科。 */
  score: number | null;
};

/** 一次考试（场次）。各科成绩挂在 `scores` 里。 */
export type ExamSession = {
  id: number;
  /** 所属赛道。赛道表要等 P1-2 才建，先允许为 null。 */
  trackId: number | null;
  /** 考试名称，如「一模」。 */
  name: string;
  /** 考试日期，`YYYY-MM-DD`。 */
  date: string;
  createdAt: string;
  scores: ExamScore[];
};

/** 录入成绩时的一科。按科目 key 提交，后端查回 subject_id。 */
export type ExamScoreInput = {
  subjectKey: string;
  score: number | null;
};

/** 新建一次考试的请求体。 */
export type CreateExamSessionPayload = {
  trackId?: number | null;
  name: string;
  date: string;
  scores: ExamScoreInput[];
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

/** 目标类型：考试 / 里程碑 / 截止日。 */
export type GoalKind = "exam" | "milestone" | "deadline";

/** 一条倒计时目标。4.0 起落在 SQLite，不再存 localStorage。 */
export type Goal = {
  id: number;
  /** 所属赛道；赛道表 P1-2 才建，先允许为 null。 */
  trackId: number | null;
  /** 目标名称，如「高考」。 */
  name: string;
  /** 目标日期，`YYYY-MM-DD`。 */
  date: string;
  kind: GoalKind;
  /** 是不是主目标。全库最多一个主目标。 */
  isPrimary: boolean;
  /** 目标分数，可空。 */
  targetScore: number | null;
  createdAt: string;
};

/** 新建 / 修改一条目标的请求体。`id` 有值就是改这一条。 */
export type UpsertGoalPayload = {
  id?: number | null;
  trackId?: number | null;
  name: string;
  date: string;
  kind?: GoalKind;
  /** 置成 true 时，其它目标同时降为普通目标。 */
  isPrimary?: boolean;
  targetScore?: number | null;
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
  /** 上游知识点 id（知识图谱），比如 `cnm_001`。自写考点与教材考点没有。 */
  graph_topic_id?: string | null;
  /** 图谱学科代号，比如 `math`。自写考点与教材考点没有。 */
  graph_subject?: string | null;
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

/** 启动时自动排今天的结果。 */
export type EnsureTodayScheduleResult = {
  /** 本次处理的日期（`YYYY-MM-DD`）。 */
  date: string;
  /** 实际新建的排期数。 */
  created: number;
  /** 因为超过每日上限而跳过的格子数。 */
  skipped: number;
  /** 参与排期的任务 id（去重，按出现顺序）。 */
  taskIds: number[];
};

export type TextbookCatalogItem = {
  subject: string;
  version: string;
  volume: string;
  source: string;
};

/** 知识图谱里的一个知识点。 */
export type KnowledgeTopic = {
  /** 上游的稳定 id，例如 `cnm_001`。 */
  id: string;
  name: string;
  /** 领域，例如「数与代数」。 */
  domain: string;
  /** 年级：1–6 小学，7–9 初中，10 及以上高中。 */
  grade: number;
  /** 学段：小学 / 初中 / 高中 / 其他。后端按年级填好。 */
  stage: string;
  /** 册次：「上」「下」或「全」。 */
  semester: string;
  /** 人教版章节，例如「七上 第一章 有理数 1.2.1」。 */
  chapter: string;
  /** 知识点类型：conceptual / procedural / reasoning / application / modeling。 */
  type: string;
  description: string;
  masteryCriteria: string[];
  diagnosticQuestion: { question: string; answer: string } | null;
  /** 引用到的数学知识点（物理用它连数学，不算先修边）。 */
  mathLinks: { id: string; reason: string }[];
};

/** 先修链上的一环。 */
export type PrerequisiteNode = {
  topic: KnowledgeTopic;
  /** `hard`（硬门槛）或 `soft`（有帮助但不是门槛）。 */
  strength: string;
  reason: string;
  /** 距离查询点的跳数。1 是直接先修。 */
  depth: number;
};

/** 某个知识点的先修信息。 */
export type PrerequisiteResult = {
  topic: KnowledgeTopic;
  /** 直接先修，硬的在前。 */
  direct: PrerequisiteNode[];
  /** 沿硬先修回溯到的深层前置。 */
  ancestors: PrerequisiteNode[];
};

/** 一条排期建议：先修还没学完就排了后面。 */
export type PrerequisiteConflict = {
  /** `order_swapped`（同任务内顺序颠倒）或 `prerequisite_task_incomplete`（先修所在任务没学完）。 */
  kind: string;
  /** 出问题的那场：依赖先修的考点。 */
  topicId: string;
  topicName: string;
  /** 先修考点。 */
  prerequisiteId: string;
  prerequisiteName: string;
  /** 先修边强度，这里恒为 `hard`。 */
  strength: string;
  /** 先修考点在哪个任务里。 */
  prerequisiteTaskId: number | null;
  prerequisiteTaskTitle: string | null;
  /** 先修任务还差多少单元。 */
  prerequisiteTaskRemaining: number | null;
  /** 本任务第一场还没上的日期。 */
  dependentSessionDate: string | null;
  /** 先修任务第一场还没上的日期。 */
  prerequisiteSessionDate: string | null;
  /** 一句人话，直接显示。 */
  message: string;
};

/** 工具箱里的一个学科包。 */
export type KnowledgePackEntry = {
  subject: string;
  name: string;
  /** 这个学科有多少个知识点。 */
  count: number;
  /** `builtin` 随应用内置，`downloaded` 已下载到本地，`available` 还没下载。 */
  state: string;
  builtin: boolean;
};

/** 下载完的学科包。 */
export type KnowledgePack = {
  subject: string;
  name: string;
  /** 知识点 id 前缀。 */
  prefix: string;
  count: number;
};

/** 知识点包下载进度。 */
export type KnowledgeDownloadProgress = {
  subject: string;
  /** `topics` 或 `dependencies`。 */
  file: string;
  downloaded: number;
  total: number;
};

/** 常用时段改动前后的对应关系：把排在旧时段上的场次挪到新时段。 */
export type TimeShiftChange = {
  fromStart: string;
  fromEnd: string;
  toStart: string;
  toEnd: string;
};

/** 批量把常用时段改动落到已排场次上的入参。 */
export type ApplyPresetTimeChangesInput = {
  changes: TimeShiftChange[];
  /** 只动这一天及以后（含当天）；不填就是今天。 */
  fromDate?: string | null;
};

/** 批量挪动排期的结果。 */
export type PresetShiftResult = {
  /** 命中旧时段、理论上要挪的场次数。 */
  matched: number;
  /** 实际挪走的场次数。 */
  updated: number;
  /** 挪过去会撞车、因此保持原样的场次数。 */
  conflicts: number;
};

/** 常用时长改动前后的对应关系：把排在旧时长上的场次改到新时长。 */
export type DurationShiftChange = {
  /** 原来的时长（分钟）。 */
  fromMinutes: number;
  /** 新的时长（分钟）。 */
  toMinutes: number;
};

/** 批量把常用时长改动落到已排场次上的入参。 */
export type ApplyPresetDurationChangesInput = {
  changes: DurationShiftChange[];
  /** 只动这一天及以后（含当天）；不填就是今天。 */
  fromDate?: string | null;
};

/** 批量改时长的结果。 */
export type PresetDurationShiftResult = {
  /** 命中旧时长、理论上要改的场次数。 */
  matched: number;
  /** 实际改掉的场次数。 */
  updated: number;
  /** 改过去会撞车、因此保持原样的场次数。 */
  conflicts: number;
};
