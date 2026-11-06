import type { ExamRecord } from "../types";
import { EXAM_SCORE_FIELDS } from "./examRecord";
import { examTotal, formatScoreGap } from "./scoreTrend";

export type ScoreOverview =
  | {
      kind: "total";
      score: number;
      gap: string | null;
      tone: "above" | "below" | null;
    }
  | {
      kind: "single";
      subject: string;
      score: number;
    }
  | {
      kind: "partial";
      count: number;
      sum: number;
    };

function filledSubjects(record: ExamRecord): { label: string; score: number }[] {
  const filled: { label: string; score: number }[] = [];
  for (const field of EXAM_SCORE_FIELDS) {
    const score = record[field.key];
    if (score != null) filled.push({ label: field.label, score });
  }
  return filled;
}

/** Newest dated sitting that actually has a score. Same-day ties use the larger id. */
export function latestScoredExam(records: ExamRecord[]): ExamRecord | null {
  const sorted = [...records].sort(
    (a, b) => b.exam_date.localeCompare(a.exam_date) || b.id - a.id,
  );
  return sorted.find((record) => filledSubjects(record).length > 0) ?? null;
}

function finiteTarget(target: number | null | undefined): number | null {
  if (target == null || !Number.isFinite(target)) return null;
  return target;
}

/**
 * Latest sitting. A full six-subject paper can be compared with the current
 * total target. One subject stays a single-subject line. A partial paper is
 * not compared with the gaokao total.
 */
export function buildScoreOverview(
  records: ExamRecord[],
  totalTarget: number | null,
): ScoreOverview | null {
  const record = latestScoredExam(records);
  if (!record) return null;
  const total = examTotal(record);
  if (total != null) {
    const target = finiteTarget(totalTarget);
    if (target == null) return { kind: "total", score: total, gap: null, tone: null };
    return {
      kind: "total",
      score: total,
      gap: formatScoreGap(total, target),
      tone: total >= target ? "above" : "below",
    };
  }
  const filled = filledSubjects(record);
  if (filled.length === 1) {
    return { kind: "single", subject: filled[0].label, score: filled[0].score };
  }
  const sum = filled.reduce((acc, item) => acc + item.score, 0);
  return { kind: "partial", count: filled.length, sum };
}
