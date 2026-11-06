/** Offsets before this year's June 7. After that day, add one more year. */
const GRADE_YEAR_OFFSET: Record<string, number> = {
  高一: 2,
  高二: 1,
  高三: 0,
};

/**
 * Next gaokao date for a grade, `YYYY-06-07`.
 * June 7 itself still belongs to this year's exam. The day after, it has passed.
 * In November 2026 that is 高一 2029, 高二 2028, 高三 2027.
 */
export function gaokaoDateForGrade(grade: string, now: Date = new Date()): string {
  const year = now.getFullYear();
  const passed = now.getMonth() > 5 || (now.getMonth() === 5 && now.getDate() > 7);
  const base = GRADE_YEAR_OFFSET[grade] ?? GRADE_YEAR_OFFSET.高三;
  return `${year + base + (passed ? 1 : 0)}-06-07`;
}
