import { describe, expect, it } from "vitest";
import {
  DEFAULT_MISTAKE_REASON,
  MISTAKE_REASONS,
  filterMistakes,
  normalizeReason,
  normalizeSubject,
  reasonCounts,
  summarizeMistakes,
} from "../mistakes";
import type { Mistake } from "../../types";

function makeMistake(partial: Partial<Mistake> & { id: number }): Mistake {
  return {
    subject: "物理",
    title: "题",
    reason: "概念不清",
    correct_note: "",
    is_mastered: 0,
    created_at: "2026-11-18 10:00:00",
    updated_at: "2026-11-18 10:00:00",
    ...partial,
  };
}

describe("mistakes lib", () => {
  it("mistake_reasons_match_the_backend_whitelist", () => {
    // 与 Rust `REASON_WHITELIST` 一一对应（Rust 侧有护栏测试反向校验本文件）。
    expect([...MISTAKE_REASONS]).toEqual([
      "概念不清",
      "公式记错",
      "审题失误",
      "计算失误",
      "方法不会",
      "粗心大意",
      "其他",
    ]);
  });

  it("normalize_reason_falls_back_to_other", () => {
    expect(normalizeReason("概念不清")).toBe("概念不清");
    expect(normalizeReason("  审题失误  ")).toBe("审题失误");
    expect(normalizeReason("瞎写的")).toBe(DEFAULT_MISTAKE_REASON);
    expect(normalizeReason("")).toBe(DEFAULT_MISTAKE_REASON);
  });

  it("normalize_subject_trims_and_defaults_to_other", () => {
    expect(normalizeSubject("  物理 ")).toBe("物理");
    expect(normalizeSubject("   ")).toBe("其他");
    expect(normalizeSubject("")).toBe("其他");
  });

  it("summarize_mistakes_counts_pending_and_mastered", () => {
    expect(summarizeMistakes([])).toEqual({
      total: 0,
      mastered: 0,
      pending: 0,
      rate: 0,
    });

    const summary = summarizeMistakes([
      makeMistake({ id: 1, is_mastered: 0 }),
      makeMistake({ id: 2, is_mastered: 1 }),
      makeMistake({ id: 3, is_mastered: 1 }),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.mastered).toBe(2);
    expect(summary.pending).toBe(1);
    expect(summary.rate).toBeCloseTo(2 / 3);
  });

  it("filter_mistakes_splits_pending_and_mastered", () => {
    const rows = [
      makeMistake({ id: 1, is_mastered: 0 }),
      makeMistake({ id: 2, is_mastered: 1 }),
    ];
    expect(filterMistakes(rows, "all")).toHaveLength(2);
    expect(filterMistakes(rows, "pending").map((m) => m.id)).toEqual([1]);
    expect(filterMistakes(rows, "mastered").map((m) => m.id)).toEqual([2]);
  });

  it("reason_counts_lists_the_most_common_reason_first", () => {
    const rows = [
      makeMistake({ id: 1, reason: "计算失误" }),
      makeMistake({ id: 2, reason: "计算失误" }),
      makeMistake({ id: 3, reason: "审题失误" }),
      // 未知错因归到「其他」，不另起一組。
      makeMistake({ id: 4, reason: "瞎写的" }),
    ];
    const counts = reasonCounts(rows);
    expect(counts[0]).toEqual({ reason: "计算失误", count: 2 });
    expect(counts).toContainEqual({ reason: "其他", count: 1 });
    expect(counts).toHaveLength(3);
  });
});