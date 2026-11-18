import { pad2 } from "./date";

/**
 * 时间选择的纯逻辑：小时/分钟档位、常用时段、时长快捷。
 *
 * 面向「不想碰原生时间控件」的自学场景：点两下就能定好一个时段。
 */

export const HOUR_CHOICES = [
  6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
] as const;

export const MINUTE_CHOICES = [0, 15, 30, 45] as const;

export type TimePreset = { label: string; start: string; end: string };

/** 常用时段：一键把开始与结束一起设好。 */
export const TIME_PRESETS: TimePreset[] = [
  { label: "早读 07:00–08:00", start: "07:00", end: "08:00" },
  { label: "上午 08:00–09:00", start: "08:00", end: "09:00" },
  { label: "上午 09:00–10:00", start: "09:00", end: "10:00" },
  { label: "上午 10:00–11:00", start: "10:00", end: "11:00" },
  { label: "下午 14:00–15:00", start: "14:00", end: "15:00" },
  { label: "下午 15:00–16:00", start: "15:00", end: "16:00" },
  { label: "下午 16:00–17:00", start: "16:00", end: "17:00" },
  { label: "晚上 19:00–20:00", start: "19:00", end: "20:00" },
  { label: "晚自习 20:00–21:00", start: "20:00", end: "21:00" },
  { label: "晚自习 21:00–22:00", start: "21:00", end: "22:00" },
];

/** 时长快捷：以开始时间为基准推算结束时间。 */
export const DURATION_PRESETS = [30, 45, 60, 90, 120] as const;

/** 解析 "HH:MM"，非法返回 null。 */
export function parseHhmm(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function formatHhmm(hour: number, minute: number): string {
  const h = Math.min(Math.max(Math.trunc(hour), 0), 23);
  const m = Math.min(Math.max(Math.trunc(minute), 0), 59);
  return `${pad2(h)}:${pad2(m)}`;
}

/**
 * 在 HH:MM 上加分钟数；超过当天结束就停在 23:59。
 * 非法输入按 00:00 处理。
 */
export function addMinutesToHhmm(value: string, delta: number): string {
  const parsed = parseHhmm(value);
  const base = parsed ? parsed.hour * 60 + parsed.minute : 0;
  const next = base + Math.trunc(delta);
  const clamped = Math.min(Math.max(next, 0), 23 * 60 + 59);
  return formatHhmm(Math.floor(clamped / 60), clamped % 60);
}

/** `90` → 「1 小时 30 分钟」；`60` → 「1 小时」；`45` → 「45 分钟」。 */
export function formatDurationLabel(minutes: number): string {
  const total = Math.max(0, Math.trunc(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} 分钟`;
  if (rest === 0) return `${hours} 小时`;
  return `${hours} 小时 ${rest} 分钟`;
}
