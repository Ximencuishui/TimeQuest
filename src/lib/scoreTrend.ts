import type { ExamRecord, SubjectTargets } from "../types";
import { EXAM_SCORE_FIELDS, type ExamScoreKey } from "./examRecord";

export type ScoreTrendSubject = "total" | keyof SubjectTargets;

export type ScoreTargets = {
  [K in keyof SubjectTargets]: number | null;
} & { total: number | null };

export type TrendPoint = {
  id: number;
  examName: string;
  examDate: string;
  label: string;
  score: number | null;
  target: number | null;
  latest: boolean;
};

/** Six papers present → comparable total. A skipped subject stays out of the total line. */
export function examTotal(record: ExamRecord): number | null {
  let sum = 0;
  for (const field of EXAM_SCORE_FIELDS) {
    const value = record[field.key];
    if (value == null) return null;
    sum += value;
  }
  return sum;
}

export function scoreForSubject(record: ExamRecord, subject: ScoreTrendSubject): number | null {
  if (subject === "total") return examTotal(record);
  const key = `${subject}_score` as ExamScoreKey;
  return record[key];
}

/** `null` / 非有限数表示还没设目标，图表不画参考线。 */
export function targetForSubject(
  targets: ScoreTargets,
  subject: ScoreTrendSubject,
): number | null {
  const raw = subject === "total" ? targets.total : targets[subject];
  if (raw == null || !Number.isFinite(raw)) return null;
  return raw;
}

/** `+10 分` / `-5 分` / `0 分`. */
export function formatScoreGap(score: number, target: number): string {
  const gap = score - target;
  if (gap > 0) return `+${gap} 分`;
  return `${gap} 分`;
}

/** Oldest exam on the left. Same-day sittings keep id order and get a distinct axis label. */
export function buildTrendPoints(
  records: ExamRecord[],
  subject: ScoreTrendSubject,
  targets: ScoreTargets,
): TrendPoint[] {
  const target = targetForSubject(targets, subject);
  const sorted = [...records].sort(
    (a, b) => a.exam_date.localeCompare(b.exam_date) || a.id - b.id,
  );
  const seen = new Map<string, number>();
  const points = sorted.map((record) => {
    const count = seen.get(record.exam_date) ?? 0;
    seen.set(record.exam_date, count + 1);
    const label = count === 0 ? record.exam_date : `${record.exam_date} (${count + 1})`;
    return {
      id: record.id,
      examName: record.exam_name,
      examDate: record.exam_date,
      label,
      score: scoreForSubject(record, subject),
      target,
      latest: false,
    };
  });
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].score != null) {
      points[i].latest = true;
      break;
    }
  }
  return points;
}

export type TrendSegment = {
  key: string;
  tone: "above" | "below" | "plain";
};

export type TrendChartRow = {
  id: number;
  label: string;
  examName: string;
  examDate: string;
  score: number | null;
  target: number | null;
  latest: boolean;
  [segment: string]: number | string | boolean | null;
};

/** One series per step so the stroke can turn green or orange at each exam. */
export function buildTrendChart(points: TrendPoint[]): {
  rows: TrendChartRow[];
  segments: TrendSegment[];
} {
  const rows: TrendChartRow[] = points.map((point) => ({
    id: point.id,
    label: point.label,
    examName: point.examName,
    examDate: point.examDate,
    score: point.score,
    target: point.target,
    latest: point.latest,
  }));
  const segments: TrendSegment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const left = points[i].score;
    const right = points[i + 1].score;
    if (left == null || right == null) continue;
    const key = `seg${i}`;
    const target = points[i].target;
    const tone = target == null ? "plain" : right >= target ? "above" : "below";
    segments.push({ key, tone });
    rows[i][key] = left;
    rows[i + 1][key] = right;
  }
  return { rows, segments };
}

/**
 * 纵轴同时包住考分和目标。
 * 最低分贴在 0 时，下沿再留一截，避免点和折线被裁到绘图区外面。
 * 目标高于全部分数时，上沿按间距留白，虚线落在图内。
 */
export function trendDomain(points: TrendPoint[]): [number, number] {
  const target = points[0]?.target ?? null;
  const scores = points.flatMap((point) =>
    point.score != null && Number.isFinite(point.score) ? [point.score] : [],
  );
  const anchors = [...scores];
  if (target != null && Number.isFinite(target)) anchors.push(target);
  if (anchors.length === 0) return [0, 100];
  const min = Math.min(...anchors);
  const max = Math.max(...anchors);
  const pad = Math.max(8, Math.round((max - min) * 0.2));
  const upper = max + pad;
  const lower =
    min > 0 ? Math.max(0, min - pad) : min - Math.max(8, Math.round(Math.max(max, 1) * 0.08));
  return [lower, upper];
}

export function scoresAttribute(points: TrendPoint[]): string {
  return points.map((point) => (point.score == null ? "null" : String(point.score))).join(",");
}
