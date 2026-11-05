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
  // End of exam day morning-ish: use start of target day for calendar days,
  // but live h/m/s against target midnight of that day.
  const targetMs = target.getTime();
  const totalMs = targetMs - now.getTime();
  // Under 1s remaining is arrived. Otherwise a 1s tick paints 00:00:00
  // while the headline is still the day count.
  const isPast = totalMs < 1000;
  const abs = Math.abs(totalMs);

  const days = Math.max(0, differenceInCalendarDays(target, startOfDay(now)));
  const weeks = Math.max(0, differenceInCalendarWeeks(target, startOfDay(now)));
  const months = Math.max(
    0,
    differenceInCalendarMonths(target, startOfDay(now)),
  );

  const hours = Math.floor(abs / (1000 * 60 * 60)) % 24;
  const minutes = Math.floor(abs / (1000 * 60)) % 60;
  const seconds = Math.floor(abs / 1000) % 60;

  return {
    totalMs: isPast ? 0 : totalMs,
    days: isPast ? 0 : days,
    weeks: isPast ? 0 : weeks,
    months: isPast ? 0 : months,
    hours: isPast ? 0 : hours,
    minutes: isPast ? 0 : minutes,
    seconds: isPast ? 0 : seconds,
    isPast,
  };
}

export function todayStr(d: Date = new Date()): string {
  return format(d, "yyyy-MM-dd");
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
