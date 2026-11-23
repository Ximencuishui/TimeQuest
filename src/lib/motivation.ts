import { FALLBACK_MOTIVATIONS } from "./fallbacks";

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
  lines: readonly string[] = FALLBACK_MOTIVATIONS,
): string {
  if (lines.length === 0) return "";
  return lines[dailyMotivationIndex(date, lines.length)] ?? "";
}

/** Custom text wins. Null, missing, and blank fall back to the line for `date`. */
export function resolveMotivation(
  custom: string | null | undefined,
  date: string,
  lines: readonly string[] = FALLBACK_MOTIVATIONS,
): string {
  const text = custom?.trim() ?? "";
  if (text) return text;
  return dailyMotivation(date, lines);
}

/**
 * 赛道包里的语料包。
 *
 * 包里就是一份 JSON：`{ "id": "...", "lines": ["...", "..."] }`。
 */
export type MotivationPack = {
  id?: string;
  name?: string;
  lines?: string[];
};

/**
 * 解析赛道包的语料包。
 *
 * 读不懂（不是 JSON、不是对象、没有句子）就当作没有包：
 * 让调用方回落到内置兜底语料。
 */
export function parseMotivationPack(raw: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!value || typeof value !== "object") return [];
  const lines = (value as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
