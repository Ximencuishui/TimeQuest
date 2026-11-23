export const APP_NAME = "TimeQuest";
export const APP_SUBTITLE = "目标倒计时 · 自习推进器";
export const APP_FULL_NAME = `${APP_NAME} — ${APP_SUBTITLE}`;
export const DB_FILE = "timequest.db";

/** Default next Gaokao: June 7 */
export const DEFAULT_EXAM_DATE = "2027-06-07";

/** 启动时补的默认目标名称。 */
export const DEFAULT_GOAL_NAME = "高考";

export const ACCENT = "#F97316"; // sprint orange

/** Built-in outlines are AI-generated and may lag the latest exam syllabus. */
export const KNOWLEDGE_POINT_DISCLAIMER =
  "注：内置考点目录仅供参考，请以学校老师要求和最新考纲为准。";

/** 知识图谱数据的出处。CC BY-NC 4.0 要求署名，这里不能省。 */
export const KNOWLEDGE_GRAPH_ATTRIBUTION =
  "知识点与先修关系来自开源项目 cn-math-taxonomy（xiaoyang111222），遵循 CC BY-NC 4.0 协议。";

/** 知识图谱的免责说明。 */
export const KNOWLEDGE_GRAPH_DISCLAIMER =
  "注：知识点与先修关系由社区整理，可能与本校教学进度不一致，请以老师安排和最新考纲为准。";

/** 知识图谱插件的 id。任务考点从这里挑知识点。 */
export const KNOWLEDGE_GRAPH_PLUGIN_ID = "cn-knowledge-graph";

/**
 * 一天最多安排多少分钟的学习（12 小时）。
 *
 * 防呆上限：教材导入等批量排期可能把今天堆到几十场，
 * 「今日剩余待学」不能显示成 16 小时这种吓人的数字。
 */
export const MAX_DAILY_STUDY_MINUTES = 720;

export const NOTE_COLORS = [
  "yellow",
  "orange",
  "green",
  "blue",
  "pink",
  "purple",
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

// 科目 / 学习方式 / 每日激励语 / 错因分类都搬到 `src/lib/fallbacks.ts` 了：
// 它们是「配置缺失时的兜底语料」，业务代码走 `src/lib/content.ts` 的解析函数。

export const TAG_TYPES = [
  { value: "study", label: "学习" },
  { value: "sport", label: "运动" },
  { value: "game", label: "游戏" },
  { value: "other", label: "其他" },
] as const;
