import type { ExamRecord } from "../types";
import { EXAM_SCORE_FIELDS, type ExamScoreKey } from "./examRecord";
import type { SubjectKey } from "./profile";

/**
 * 各科满分：语文 120、数学 130、英语 120、理化生各 80，合计 610。
 * 与设置页的默认目标（`DEFAULT_SUBJECT_TARGETS`）一致。
 */
export const SUBJECT_FULL_MARKS: Record<SubjectKey, number> = {
  chinese: 120,
  math: 130,
  english: 120,
  physics: 80,
  chemistry: 80,
  biology: 80,
};

/** 六科满分合计。 */
export const TOTAL_FULL_MARKS = 610;

/**
 * 只有一科成绩时不做折算——拿一科推六科没有意义，
 * 那种记录按「最近单科」显示。
 */
export const MIN_SUBJECTS_FOR_SCALING = 2;

export type ExamScoreBreakdown = {
  /** 已考的科目。 */
  filled: { key: ExamScoreKey; subject: SubjectKey; label: string; score: number }[];
  /** 缺考的科目。 */
  missing: { key: ExamScoreKey; subject: SubjectKey; label: string }[];
  /** 实考总分。 */
  sum: number;
  /** 已考科目的满分之和（缺考科目不计入）。 */
  takenFullMarks: number;
  /** 折算到六科口径的总分；六科全齐时就是实考总分。一科都没考时是 null。 */
  scaledTotal: number | null;
  /** 实考总分 ÷ 已考满分。 */
  rate: number;
};

/**
 * 拆开一次考试：哪些考了、哪些缺考、实考多少分、
 * 缺考时按比例折算成多少分。
 *
 * 折算口径：`折算总分 = 实考总分 × 六科满分 ÷ 已考科目满分之和`，
 * 也就是把缺考科目按已考科目的得分率补齐，得到和「六科都考了」可比的分数。
 */
export function examScoreBreakdown(record: ExamRecord): ExamScoreBreakdown {
  const filled: ExamScoreBreakdown["filled"] = [];
  const missing: ExamScoreBreakdown["missing"] = [];
  let sum = 0;
  let takenFullMarks = 0;

  for (const field of EXAM_SCORE_FIELDS) {
    const score = record[field.key];
    if (score == null) {
      missing.push({ key: field.key, subject: field.subject, label: field.label });
      continue;
    }
    filled.push({ key: field.key, subject: field.subject, label: field.label, score });
    sum += score;
    takenFullMarks += SUBJECT_FULL_MARKS[field.subject];
  }

  let scaledTotal: number | null = null;
  if (filled.length > 0) {
    scaledTotal =
      filled.length === EXAM_SCORE_FIELDS.length
        ? sum
        : Math.round((sum * TOTAL_FULL_MARKS) / takenFullMarks);
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
 * 六科都考了（或只记了一科）时返回 null，表示不需要说明。
 */
export function scaledTotalNote(record: ExamRecord): string | null {
  const breakdown = examScoreBreakdown(record);
  if (breakdown.missing.length === 0) return null;
  if (breakdown.filled.length < MIN_SUBJECTS_FOR_SCALING) return null;
  if (breakdown.scaledTotal == null) return null;
  return `实考 ${breakdown.sum} / ${breakdown.takenFullMarks} · 折算 ${breakdown.scaledTotal} / ${TOTAL_FULL_MARKS}`;
}