import { pad2 } from "./date";

/**
 * 时间选择的纯逻辑：小时/分钟档位、起止时间推算。
 *
 * 面向「不想碰原生时间控件」的自学场景：点两下就能定好一个时段。
 *
 * 常用时段 / 常用时长的快捷按钮不在这儿——它们是可编辑的全局设置，
 * 分别在 `timePresets.ts` 与 `durationPresets.ts`。
 */

export const HOUR_CHOICES = [
  6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
] as const;

export const MINUTE_CHOICES = [0, 15, 30, 45] as const;

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
