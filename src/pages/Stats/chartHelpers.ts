import { subjectAccent } from "../../lib/textbooks";
import type { MethodShareRow, PlanVsActualRow } from "../../types";

export type DonutSlice = {
  name: string;
  value: number;
  color: string;
  percent: number;
};

export type PlanVsActualBarRow = {
  subject: string;
  planned_min: number;
  actual_min: number;
  actualFill: string;
};

const KNOWN_SUBJECTS = new Set([
  "数学",
  "语文",
  "英语",
  "物理",
  "化学",
  "生物",
]);

const METHOD_COLORS = [
  "#F97316",
  "#14B8A6",
  "#3B82F6",
  "#EAB308",
  "#EC4899",
  "#A78BFA",
];

const FALLBACK_SUBJECT_COLORS = [
  "#F97316",
  "#3B82F6",
  "#A78BFA",
  "#14B8A6",
  "#EAB308",
  "#EC4899",
];

/** Minutes → display hours string for donut center. */
export function formatStudyHours(totalMin: number): string {
  if (totalMin <= 0) return "0";
  const hours = totalMin / 60;
  if (Number.isInteger(hours)) return String(hours);
  return hours.toFixed(1).replace(/\.0$/, "");
}

function withPercents(
  rows: { name: string; value: number; color: string }[],
): DonutSlice[] {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (total <= 0) return [];
  return rows.map((row) => ({
    ...row,
    percent: (row.value / total) * 100,
  }));
}

function subjectColor(subject: string, index: number): string {
  if (KNOWN_SUBJECTS.has(subject)) return subjectAccent(subject);
  return FALLBACK_SUBJECT_COLORS[index % FALLBACK_SUBJECT_COLORS.length];
}

/** Subject share from plan-vs-actual actual minutes (skip zero actual). */
export function toSubjectDonut(rows: PlanVsActualRow[]): DonutSlice[] {
  return withPercents(
    rows
      .filter((row) => row.actual_min > 0)
      .map((row, i) => ({
        name: row.subject,
        value: row.actual_min,
        color: subjectColor(row.subject, i),
      })),
  );
}

export function toMethodDonut(rows: MethodShareRow[]): DonutSlice[] {
  return withPercents(
    rows
      .filter((row) => row.duration_min > 0)
      .map((row, i) => ({
        name: row.method,
        value: row.duration_min,
        color: METHOD_COLORS[i % METHOD_COLORS.length],
      })),
  );
}

export function toPlanVsActualBars(
  rows: PlanVsActualRow[],
): PlanVsActualBarRow[] {
  return rows.map((row) => ({
    subject: row.subject,
    planned_min: row.planned_min,
    actual_min: row.actual_min,
    actualFill: row.actual_min > row.planned_min ? "#10b981" : "#f97316",
  }));
}

export function donutTotalMinutes(slices: DonutSlice[]): number {
  return slices.reduce((sum, slice) => sum + slice.value, 0);
}
