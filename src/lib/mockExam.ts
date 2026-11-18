import type { ExamTarget } from "../types";
import { daysBetween } from "./dateField";

export type MockExam = {
  id: string;
  name: string;
  date: string;
  /** 距离今天还有几天；今天就是 0。 */
  daysLeft: number;
  isToday: boolean;
};

/**
 * 最近的一次模考。
 *
 * 模考 = 除主考（高考）以外的考试目标；设置页里加一条「名称（如模考）+ 日期」即可。
 * 已经过去的目标不再倒计时，只取今天及以后的最近一个。
 */
export function nextMockExam(
  exams: ExamTarget[],
  today: string,
): MockExam | null {
  const candidates = exams
    .filter((exam) => !exam.isPrimary && exam.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const target = candidates[0];
  if (!target) return null;

  const daysLeft = daysBetween(today, target.date) ?? 0;
  return {
    id: target.id,
    name: target.name,
    date: target.date,
    daysLeft,
    isToday: daysLeft === 0,
  };
}
