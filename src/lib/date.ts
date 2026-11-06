import {
  differenceInCalendarDays,
  differenceInCalendarMonths,
  differenceInCalendarWeeks,
  format,
  parseISO,
  startOfDay,
} from "date-fns";

export type CountdownParts = {
  totalMs: number;
  days: number;
  weeks: number;
  months: number;
  hours: number;
  minutes: number;
  seconds: number;
  isPast: boolean;
};

export function computeCountdown(
  targetDate: string,
  now: Date = new Date(),
): CountdownParts {
  const target = startOfDay(parseISO(targetDate));
  if (Number.isNaN(target.getTime())) {
    return {
      totalMs: 0,
      days: 0,
      weeks: 0,
      months: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      isPast: false,
    };
  }
  // Days, weeks, and months are the calendar distance between the target
  // timestamp and now. The gaokao countdown does not keep a clock.
  const targetMs = target.getTime();
  const totalMs = targetMs - now.getTime();
  // Under 1s remaining is arrived, so the last partial second does not
  // leave the headline on a day count.
  const isPast = totalMs < 1000;

  const days = Math.max(0, differenceInCalendarDays(target, startOfDay(now)));
  const weeks = Math.max(0, differenceInCalendarWeeks(target, startOfDay(now)));
  const months = Math.max(
    0,
    differenceInCalendarMonths(target, startOfDay(now)),
  );

  return {
    totalMs: isPast ? 0 : totalMs,
    days: isPast ? 0 : days,
    weeks: isPast ? 0 : weeks,
    months: isPast ? 0 : months,
    hours: 0,
    minutes: 0,
    seconds: 0,
    isPast,
  };
}

export function todayStr(d: Date = new Date()): string {
  return format(d, "yyyy-MM-dd");
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
