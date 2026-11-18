import type { Mistake } from "../types";

/**
 * 错因分类：闭合集合，必须与 Rust `REASON_WHITELIST` 完全一致。
 *
 * 顺序即下拉框里的展示顺序：从「不会」到「粗心」。
 */
export const MISTAKE_REASONS = [
  "概念不清",
  "公式记错",
  "审题失误",
  "计算失误",
  "方法不会",
  "粗心大意",
  "其他",
] as const;

export type MistakeReason = (typeof MISTAKE_REASONS)[number];

export const DEFAULT_MISTAKE_REASON: MistakeReason = "其他";

/** 未知 / 空错因统一落到「其他」，与后端 `normalize_reason` 行为一致。 */
export function normalizeReason(raw: string): MistakeReason {
  const value = raw.trim();
  return MISTAKE_REASONS.find((r) => r === value) ?? DEFAULT_MISTAKE_REASON;
}

/** 科目是开放字符串：去空白，空的归「其他」，与后端 `normalize_subject` 一致。 */
export function normalizeSubject(raw: string): string {
  const value = raw.trim();
  return value === "" ? "其他" : value;
}

export type MistakeFilter = "all" | "pending" | "mastered";

export const MISTAKE_FILTERS: { key: MistakeFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "pending", label: "未订正" },
  { key: "mastered", label: "已订正" },
];

export function filterMistakes(mistakes: Mistake[], filter: MistakeFilter): Mistake[] {
  if (filter === "pending") return mistakes.filter((m) => m.is_mastered !== 1);
  if (filter === "mastered") return mistakes.filter((m) => m.is_mastered === 1);
  return mistakes;
}

export type MistakeSummary = {
  total: number;
  mastered: number;
  pending: number;
  /** 订正完成率（0~1）；一条都没有时是 0，避免除零。 */
  rate: number;
};

export function summarizeMistakes(mistakes: Mistake[]): MistakeSummary {
  const total = mistakes.length;
  const mastered = mistakes.filter((m) => m.is_mastered === 1).length;
  return {
    total,
    mastered,
    pending: total - mastered,
    rate: total === 0 ? 0 : mastered / total,
  };
}

/** 错因分布：从多到少，同数按名称排，用来提示「哪一类错最多」。 */
export function reasonCounts(mistakes: Mistake[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of mistakes) {
    const key = normalizeReason(m.reason);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, "zh-CN"));
}
