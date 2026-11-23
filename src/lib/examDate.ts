import type { DateRule } from "../types";

/**
 * 高考赛道的目标日期规则。
 *
 * 规则数据与赛道包 `track-gaokao` 里的 `date_rule` 一致：
 * 考试在 6 月 7 日，高一往后推 2 年、高二 1 年、高三当年。
 */
export const GAOKAO_DATE_RULE: DateRule = {
  id: "gaokao-june-7",
  anchor: "06-07",
  grade_offsets: { 高一: 2, 高二: 1, 高三: 0 },
};

/**
 * 按规则算目标日期，`YYYY-MM-DD`。
 *
 * 过了锚点这一天就算今年过去了（考试当天仍然算今年）。
 * 年级偏移由规则自己带，规则没写就按当年算。
 */
export function resolveDateRule(
  rule: DateRule,
  grade?: string | null,
  now: Date = new Date(),
): string {
  const [month, day] = rule.anchor
    .split("-")
    .map((part) => Number.parseInt(part.trim(), 10));
  if (!Number.isInteger(month) || !Number.isInteger(day)) return "";
  const year = now.getFullYear();
  // 只比日期不比时间：考试当天仍然算今年。
  const today = new Date(year, now.getMonth(), now.getDate());
  const anchor = new Date(year, month - 1, day);
  const passed = today.getTime() > anchor.getTime();
  const offset = (grade ? rule.grade_offsets?.[grade] : 0) ?? 0;
  const target = year + offset + (passed ? 1 : 0);
  return `${target}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * 高考目标日期。等价于按高考赛道的日期规则算。
 */
export function gaokaoDateForGrade(grade: string, now: Date = new Date()): string {
  return resolveDateRule(GAOKAO_DATE_RULE, grade, now);
}
