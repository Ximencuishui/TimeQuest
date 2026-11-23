import type { ExamSession, Subject } from "../types";

/**
 * 科目集合的读取工具。
 *
 * 4.0 之前成绩写死六科，所有页面直接摸 `record.chinese_score` 这类扁平字段。
 * 现在科目集合来自 `subjects` 表，成绩是「场次 + 每科一行」，页面统一从这里取。
 */

/** 按科目 key 找科目。找不到是 `undefined`。 */
export function subjectByKey(subjects: Subject[], key: string): Subject | undefined {
  return subjects.find((subject) => subject.key === key);
}

/** 按科目 id 找科目。找不到是 `undefined`。 */
export function subjectById(subjects: Subject[], id: number): Subject | undefined {
  return subjects.find((subject) => subject.id === id);
}

/** 科目 key → 科目。重复 key 时先出现的赢。 */
export function subjectsByKey(subjects: Subject[]): Map<string, Subject> {
  const map = new Map<string, Subject>();
  for (const subject of subjects) {
    if (!map.has(subject.key)) map.set(subject.key, subject);
  }
  return map;
}

/**
 * 一次考试里某科目的得分。
 *
 * 没有成绩行 = 这场没考这科（`null`）；有行但分数是空的也是 `null`。
 */
export function sessionScore(session: ExamSession, subject: Subject): number | null {
  const row = session.scores.find((score) => score.subjectId === subject.id);
  return row?.score ?? null;
}

/** 一次考试里所有有分的科目。 */
export function scoredSubjects(
  session: ExamSession,
  subjects: Subject[],
): { subject: Subject; score: number }[] {
  const out: { subject: Subject; score: number }[] = [];
  for (const subject of subjects) {
    const score = sessionScore(session, subject);
    if (score != null) out.push({ subject, score });
  }
  return out;
}
