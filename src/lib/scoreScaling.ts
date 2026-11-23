import type { ExamSession, Subject } from "../types";
import { sessionScore } from "./subjects";

/**
 * 只有一科成绩时不做折算——拿一科推全科没有意义，
 * 那种记录按「最近单科」显示。
 */
export const MIN_SUBJECTS_FOR_SCALING = 2;

/**
 * 科目满分合计。
 *
 * 以前这里写死 610（语文 120 + 数学 130 + 英语 120 + 理化生各 80），
 * 现在满分跟着 `subjects` 表走：没配满分的科目按 0 计。
 */
export function totalFullMarks(subjects: Pick<Subject, "fullMark">[]): number {
  return subjects.reduce((sum, subject) => sum + (subject.fullMark ?? 0), 0);
}

export type ExamScoreBreakdown = {
  /** 已考的科目。 */
  filled: { key: string; label: string; score: number }[];
  /** 缺考的科目。 */
  missing: { key: string; label: string }[];
  /** 实考总分。 */
  sum: number;
  /** 已考科目的满分之和（缺考科目不计入）。 */
  takenFullMarks: number;
  /** 折算到全科口径的总分；科目全齐时就是实考总分。一科都没考时是 null。 */
  scaledTotal: number | null;
  /** 实考总分 ÷ 已考满分。 */
  rate: number;
};

/**
 * 拆开一次考试：哪些考了、哪些缺考、实考多少分、
 * 缺考时按比例折算成多少分。
 *
 * 折算口径：`折算总分 = 实考总分 × 全科满分 ÷ 已考科目满分之和`，
 * 也就是把缺考科目按已考科目的得分率补齐，得到和「科目都考了」可比的分数。
 */
export function examScoreBreakdown(
  session: ExamSession,
  subjects: Subject[],
): ExamScoreBreakdown {
  const filled: ExamScoreBreakdown["filled"] = [];
  const missing: ExamScoreBreakdown["missing"] = [];
  let sum = 0;
  let takenFullMarks = 0;

  for (const subject of subjects) {
    const score = sessionScore(session, subject);
    if (score == null) {
      missing.push({ key: subject.key, label: subject.label });
      continue;
    }
    filled.push({ key: subject.key, label: subject.label, score });
    sum += score;
    takenFullMarks += subject.fullMark ?? 0;
  }

  let scaledTotal: number | null = null;
  if (filled.length > 0) {
    if (filled.length === subjects.length) {
      scaledTotal = sum;
    } else if (takenFullMarks > 0) {
      scaledTotal = Math.round((sum * totalFullMarks(subjects)) / takenFullMarks);
    }
  }

  return {
    filled,
    missing,
    sum,
    takenFullMarks,
    scaledTotal,
    rate: takenFullMarks === 0 ? 0 : sum / takenFullMarks,
  };
}

/**
 * 「实考 500 / 530 · 折算 575 / 610」。
 * 科目都考了（或只记了一科）时返回 null，表示不需要说明。
 */
export function scaledTotalNote(session: ExamSession, subjects: Subject[]): string | null {
  const breakdown = examScoreBreakdown(session, subjects);
  if (breakdown.missing.length === 0) return null;
  if (breakdown.filled.length < MIN_SUBJECTS_FOR_SCALING) return null;
  if (breakdown.scaledTotal == null) return null;
  return `实考 ${breakdown.sum} / ${breakdown.takenFullMarks} · 折算 ${breakdown.scaledTotal} / ${totalFullMarks(subjects)}`;
}
