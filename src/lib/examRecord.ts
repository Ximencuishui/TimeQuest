import type { CreateExamRecordPayload, ExamRecord } from "../types";
import { SUBJECT_FIELDS } from "./profile";

export const EXAM_SCORE_FIELDS = SUBJECT_FIELDS.map((field) => ({
  key: `${field.key}_score` as const,
  subject: field.key,
  label: field.label,
}));

export type ExamScoreKey = (typeof EXAM_SCORE_FIELDS)[number]["key"];

/** 常见高考单科满分。超过只提示，仍允许保存。 */
export const SUBJECT_SCORE_SOFT_MAX = 150;

/** 六科常见满分合计。超过只提示，仍允许保存。 */
export const TOTAL_SCORE_SOFT_MAX = 750;

/** 单科输入最多三位，挡住粘贴进来的超长数字，151–999 仍可保存。 */
export function digitsOnlyScore(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 3);
}

export type ExamScoreDraft = Record<ExamScoreKey, string>;

export function emptyExamScores(): ExamScoreDraft {
  return {
    chinese_score: "",
    math_score: "",
    english_score: "",
    physics_score: "",
    chemistry_score: "",
    biology_score: "",
  };
}

function parseScore(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return "invalid";
  return value;
}

/** Blank scores stay `null` so an exam that skipped a paper can still be saved. */
export function parseExamDraft(input: {
  examName: string;
  examDate: string;
  scores: ExamScoreDraft;
}):
  | { ok: true; payload: CreateExamRecordPayload }
  | { ok: false; message: string } {
  const examName = input.examName.trim();
  if (!examName) return { ok: false, message: "请填写考试名称" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.examDate)) {
    return { ok: false, message: "请选择考试日期" };
  }
  const scores = {} as Pick<CreateExamRecordPayload, ExamScoreKey>;
  for (const field of EXAM_SCORE_FIELDS) {
    const parsed = parseScore(input.scores[field.key]);
    if (parsed === "invalid") {
      return { ok: false, message: `${field.label}成绩请输入非负整数` };
    }
    scores[field.key] = parsed;
  }
  if (EXAM_SCORE_FIELDS.every((field) => scores[field.key] == null)) {
    return { ok: false, message: "请至少填写一科成绩" };
  }
  return {
    ok: true,
    payload: {
      exam_name: examName,
      exam_date: input.examDate,
      ...scores,
    },
  };
}

/** 高于常见满分时给一句提示。不拦截保存。 */
export function examScoreWarning(scores: ExamScoreDraft): string | null {
  const highs: string[] = [];
  let sum = 0;
  let any = false;
  for (const field of EXAM_SCORE_FIELDS) {
    const parsed = parseScore(scores[field.key]);
    if (parsed === "invalid" || parsed == null) continue;
    any = true;
    sum += parsed;
    if (parsed > SUBJECT_SCORE_SOFT_MAX) highs.push(`${field.label} ${parsed} 分`);
  }
  if (!any) return null;
  const parts: string[] = [];
  if (highs.length > 0) {
    parts.push(`${highs.join("、")}高于常见单科上限 ${SUBJECT_SCORE_SOFT_MAX}`);
  }
  if (sum > TOTAL_SCORE_SOFT_MAX) {
    parts.push(`已填合计 ${sum}，高于常见总分上限 ${TOTAL_SCORE_SOFT_MAX}`);
  }
  if (parts.length === 0) return null;
  return `${parts.join("。")}。仍可保存。`;
}

export function filledScoreSum(record: ExamRecord): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (const field of EXAM_SCORE_FIELDS) {
    const value = record[field.key];
    if (value != null) {
      count += 1;
      sum += value;
    }
  }
  return { count, sum };
}
