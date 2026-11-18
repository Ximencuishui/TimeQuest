import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfWeek,
} from "date-fns";
import { parseLocalDate, toIsoDate, WEEKDAY_LABELS } from "./calendar";
import { pad2 } from "./date";

/**
 * 日期选择的纯逻辑：快捷日期文案、月历网格。
 *
 * 网格与日历视图一致：周一开始，整周补齐。
 */

export function weekdayLabel(iso: string): string {
  const date = parseLocalDate(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `周${WEEKDAY_LABELS[(date.getDay() + 6) % 7]}`;
}

/** `2026-11-18` → `11月18日`；解析不了就原样返回。 */
export function shortDateLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${Number(match[2])}月${Number(match[3])}日`;
}

/** 今天/明天/后天；不是这三天返回 null。 */
export function relativeDayLabel(iso: string, today: string): string | null {
  const diff = daysBetween(today, iso);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === 2) return "后天";
  return null;
}

/** `to - from` 的自然日差；非法输入返回 null。 */
export function daysBetween(from: string, to: string): number | null {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const day = 24 * 60 * 60 * 1000;
  return Math.round((b.getTime() - a.getTime()) / day);
}

export function addDaysIso(iso: string, days: number): string {
  const date = parseLocalDate(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return toIsoDate(addDays(date, days));
}

/** 下周一（不含今天）。 */
export function nextMondayIso(iso: string): string {
  const date = parseLocalDate(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const weekday = (date.getDay() + 6) % 7;
  return toIsoDate(addDays(date, 7 - weekday));
}

/** `2026-11-18` → `2026-11`；解析不了就原样返回。 */
export function monthKey(iso: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(iso);
  return match ? `${match[1]}-${match[2]}` : iso;
}

/** `2026-11` → `2026年11月`。 */
export function monthLabelZh(monthIso: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthIso.trim());
  if (!match) return monthIso;
  return `${match[1]}年${Number(match[2])}月`;
}

function parseMonthKey(monthIso: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthIso.trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1);
}

/** 月历网格：该月整周补齐，周一开始。 */
export function monthGridIso(monthIso: string): string[] {
  const date = parseMonthKey(monthIso);
  if (!date) return [];
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(date), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end }).map((day) => toIsoDate(day));
}

/** 月份偏移，返回新的月份 key。 */
export function shiftMonthIso(monthIso: string, delta: number): string {
  const date = parseMonthKey(monthIso);
  if (!date) return monthIso;
  const shifted = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}`;
}
