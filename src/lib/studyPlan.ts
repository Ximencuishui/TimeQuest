import { MAX_DAILY_STUDY_MINUTES } from "./constants";
import { timeToMinutes } from "./sessionTime";

/** `app_settings` 里存每日可用时段与每日上限的键。 */
export const DAILY_SLOTS_SETTING_KEY = "daily_slots";
export const DAILY_LIMIT_SETTING_KEY = "daily_limit_minutes";

/** `app_settings` 里存「启动时自动排今天的计划」开关的键。 */
export const AUTO_SCHEDULE_SETTING_KEY = "auto_schedule_today";

export type DailySlot = { start: string; end: string };

/** 默认三段：早上、下午、晚上各一小时。 */
export const DEFAULT_DAILY_SLOTS: DailySlot[] = [
  { start: "08:00", end: "09:00" },
  { start: "14:00", end: "15:00" },
  { start: "19:00", end: "20:00" },
];

/** 每日学习上限默认 8 小时。 */
export const DEFAULT_DAILY_LIMIT_MINUTES = 480;

/** 上限至少一小时，太少等于没排。 */
export const MIN_DAILY_LIMIT_MINUTES = 60;

/** 一段可用时段是否成立：时间能解析，且结束晚于开始。 */
export function isValidDailySlot(slot: DailySlot): boolean {
  const start = timeToMinutes(slot.start);
  const end = timeToMinutes(slot.end);
  if (start === null || end === null) return false;
  return end > start;
}

/**
 * 读回每日可用时段。
 *
 * 没设置过就给默认三段；写坏了（不是 JSON、不是数组）也退回默认三段，
 * 免得设置页把计划弄没了。
 */
export function parseDailySlots(raw: string | null | undefined): DailySlot[] {
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_DAILY_SLOTS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_DAILY_SLOTS;
  }
  if (!Array.isArray(parsed)) return DEFAULT_DAILY_SLOTS;

  const slots: DailySlot[] = [];
  for (const item of parsed) {
    if (Array.isArray(item) && item.length === 2) {
      slots.push({ start: String(item[0]), end: String(item[1]) });
      continue;
    }
    if (item && typeof item === "object" && "start" in item && "end" in item) {
      const obj = item as { start: unknown; end: unknown };
      slots.push({ start: String(obj.start), end: String(obj.end) });
    }
  }
  return slots.filter(isValidDailySlot);
}

/** 把时段写进 `app_settings`（存成 `[["08:00","09:00"], ...]`）。 */
export function serializeDailySlots(slots: DailySlot[]): string {
  return JSON.stringify(slots.map((slot) => [slot.start, slot.end]));
}

/** 读回每日学习上限（分钟），并夹在合理区间内。 */
export function parseDailyLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_DAILY_LIMIT_MINUTES;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_DAILY_LIMIT_MINUTES;
  return Math.min(
    Math.max(Math.round(value), MIN_DAILY_LIMIT_MINUTES),
    MAX_DAILY_STUDY_MINUTES,
  );
}

/** 这些时段一天一共能学多少分钟。 */
export function dailySlotMinutes(slots: DailySlot[]): number {
  return slots.reduce((sum, slot) => {
    const start = timeToMinutes(slot.start);
    const end = timeToMinutes(slot.end);
    if (start === null || end === null || end <= start) return sum;
    return sum + (end - start);
  }, 0);
}

/**
 * 自动排期开关：未写入、空串都算开启，只有明确的 `0` / `false` 才关掉。
 *
 * 与后端 `planner.rs` 的 `auto_schedule_enabled` 同一套口径。
 */
export function isAutoScheduleEnabled(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  if (trimmed === "") return true;
  return trimmed !== "0" && trimmed.toLowerCase() !== "false";
}

/** 常用时段预设：点一下就能填好。 */
export const DAILY_SLOT_PRESETS: { label: string; slots: DailySlot[] }[] = [
  { label: "默认三段", slots: DEFAULT_DAILY_SLOTS },
  {
    label: "上午",
    slots: [{ start: "08:00", end: "11:30" }],
  },
  {
    label: "下午",
    slots: [{ start: "14:00", end: "17:30" }],
  },
  {
    label: "晚上",
    slots: [{ start: "19:00", end: "22:30" }],
  },
  {
    label: "早晚两段",
    slots: [
      { start: "09:00", end: "11:30" },
      { start: "19:00", end: "22:00" },
    ],
  },
];
