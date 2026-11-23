import type { CreateExamSessionPayload, ExamSession, Subject } from "../types";
import { sessionScore } from "./subjects";

/** 常见单科满分。超过只提示，仍允许保存。 */
export const SUBJECT_SCORE_SOFT_MAX = 150;

/** 常见总分上限。超过只提示，仍允许保存。 */
export const TOTAL_SCORE_SOFT_MAX = 750;

/** 单科输入最多三位，挡住粘贴进来的超长数字，151–999 仍可保存。 */
export function digitsOnlyScore(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 3);
}

/** 录入表单的草稿：科目 key → 输入框里的字符串。 */
export type ExamScoreDraft = Record<string, string>;

/** 按科目集合起一份空草稿。 */
export function emptyExamScores(subjects: Subject[]): ExamScoreDraft {
  const draft: ExamScoreDraft = {};
  for (const subject of subjects) draft[subject.key] = "";
  return draft;
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
  subjects: Subject[];
}): { ok: true; payload: CreateExamSessionPayload } | { ok: false; message: string } {
  const examName = input.examName.trim();
  if (!examName) return { ok: false, message: "请填写考试名称" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.examDate)) {
    return { ok: false, message: "请选择考试日期" };
  }
  const scores = [];
  for (const subject of input.subjects) {
    const parsed = parseScore(input.scores[subject.key] ?? "");
    if (parsed === "invalid") {
      return { ok: false, message: `${subject.label}成绩请输入非负整数` };
    }
    scores.push({ subjectKey: subject.key, score: parsed });
  }
  if (scores.every((row) => row.score == null)) {
    return { ok: false, message: "请至少填写一科成绩" };
  }
  return {
    ok: true,
    payload: {
      name: examName,
      date: input.examDate,
      scores,
    },
  };
}

/** 高于常见满分时给一句提示。不拦截保存。 */
export function examScoreWarning(scores: ExamScoreDraft, subjects: Subject[]): string | null {
  const highs: string[] = [];
  let sum = 0;
  let any = false;
  for (const subject of subjects) {
    const parsed = parseScore(scores[subject.key] ?? "");
    if (parsed === "invalid" || parsed == null) continue;
    any = true;
    sum += parsed;
    if (parsed > SUBJECT_SCORE_SOFT_MAX) highs.push(`${subject.label} ${parsed} 分`);
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

export function filledScoreSum(
  session: ExamSession,
  subjects: Subject[],
): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (const subject of subjects) {
    const value = sessionScore(session, subject);
    if (value != null) {
      count += 1;
      sum += value;
    }
  }
  return { count, sum };
}
