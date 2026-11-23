import type { ExamSession, Subject } from "../types";
import { sessionScore } from "./subjects";
import { examScoreBreakdown } from "./scoreScaling";
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
      kind: "scaled";
      /** 折算后的总分（可与总分目标比）。 */
      score: number;
      /** 实考总分。 */
      sum: number;
      /** 已考科目数。 */
      count: number;
      /** 缺考的科目名。 */
      missing: string[];
      gap: string | null;
      tone: "above" | "below" | null;
    };

function filledSubjects(
  session: ExamSession,
  subjects: Subject[],
): { label: string; score: number }[] {
  const filled: { label: string; score: number }[] = [];
  for (const subject of subjects) {
    const score = sessionScore(session, subject);
    if (score != null) filled.push({ label: subject.label, score });
  }
  return filled;
}

/** Newest dated sitting that actually has a score. Same-day ties use the larger id. */
export function latestScoredExam(
  sessions: ExamSession[],
  subjects: Subject[],
): ExamSession | null {
  const sorted = [...sessions].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id - a.id,
  );
  return sorted.find((session) => filledSubjects(session, subjects).length > 0) ?? null;
}

function finiteTarget(target: number | null | undefined): number | null {
  if (target == null || !Number.isFinite(target)) return null;
  return target;
}

/**
 * Latest sitting. A full paper can be compared with the current total target.
 * One subject stays a single-subject line. A partial paper is scaled to the
 * full subject scale so it stays comparable with the target.
 */
export function buildScoreOverview(
  sessions: ExamSession[],
  totalTarget: number | null,
  subjects: Subject[],
): ScoreOverview | null {
  const session = latestScoredExam(sessions, subjects);
  if (!session) return null;
  const total = examTotal(session, subjects);
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
  const filled = filledSubjects(session, subjects);
  if (filled.length === 1) {
    return { kind: "single", subject: filled[0].label, score: filled[0].score };
  }
  const breakdown = examScoreBreakdown(session, subjects);
  const score = breakdown.scaledTotal ?? breakdown.sum;
  const target = finiteTarget(totalTarget);
  return {
    kind: "scaled",
    score,
    sum: breakdown.sum,
    count: filled.length,
    missing: breakdown.missing.map((m) => m.label),
    gap: target == null ? null : formatScoreGap(score, target),
    tone: target == null ? null : score >= target ? "above" : "below",
  };
}
