import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";

/** Monday-first labels, matching the accumulation wall and stats week. */
export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

/** `YYYY-MM-DD` as a local calendar date. Avoids `parseISO`, which treats the date as UTC midnight. */
export function parseLocalDate(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return new Date(NaN);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function toIsoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Visible grid: the month plus the leading and trailing days that fill Monday–Sunday weeks. */
export function monthGridDays(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end });
}

export function chunkWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

export function gridRange(month: Date): { start: string; end: string } {
  const days = monthGridDays(month);
  return {
    start: toIsoDate(days[0]),
    end: toIsoDate(days[days.length - 1]),
  };
}

export function monthLabel(month: Date): string {
  return `${format(month, "yyyy")}年 ${format(month, "M")}月`;
}

export function shiftMonth(month: Date, delta: number): Date {
  return startOfMonth(addMonths(month, delta));
}
