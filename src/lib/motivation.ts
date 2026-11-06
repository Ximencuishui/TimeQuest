import { DEFAULT_MOTIVATIONS } from "./constants";

/**
 * Index of the built-in line for a calendar day.
 * `YYYY-MM-DD` becomes an integer (`2026-01-01` → `20260101`) and wraps with `% length`,
 * so the same local date always picks the same line and the next day moves one step.
 */
export function dailyMotivationIndex(date: string, length: number): number {
  if (length <= 0) return 0;
  const n = Number(date.replace(/-/g, ""));
  if (!Number.isSafeInteger(n)) return 0;
  return n % length;
}

export function dailyMotivation(
  date: string,
  lines: readonly string[] = DEFAULT_MOTIVATIONS,
): string {
  if (lines.length === 0) return "";
  return lines[dailyMotivationIndex(date, lines.length)] ?? "";
}

/** Custom text wins. Null, missing, and blank fall back to the line for `date`. */
export function resolveMotivation(
  custom: string | null | undefined,
  date: string,
  lines: readonly string[] = DEFAULT_MOTIVATIONS,
): string {
  const text = custom?.trim() ?? "";
  if (text) return text;
  return dailyMotivation(date, lines);
}
