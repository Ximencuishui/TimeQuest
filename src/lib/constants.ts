export const APP_NAME = "TimeQuest";
export const APP_SUBTITLE = "高考倒计时 · 自习推进器";
export const APP_FULL_NAME = `${APP_NAME} — ${APP_SUBTITLE}`;
export const DB_FILE = "timequest.db";

/** Default next Gaokao: June 7 */
export const DEFAULT_EXAM_DATE = "2027-06-07";

export const ACCENT = "#F97316"; // sprint orange

export const NOTE_COLORS = [
  "yellow",
  "orange",
  "green",
  "blue",
  "pink",
  "purple",
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

export const SUBJECTS = [
  "语文",
  "数学",
  "英语",
  "物理",
  "化学",
  "生物",
  "历史",
  "地理",
  "政治",
  "其他",
] as const;

export const METHODS = ["听课", "刷题", "整理"] as const;

export const TAG_TYPES = [
  { value: "study", label: "学习" },
  { value: "sport", label: "运动" },
  { value: "game", label: "游戏" },
  { value: "other", label: "其他" },
] as const;
