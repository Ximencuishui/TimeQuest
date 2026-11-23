import { describe, expect, it } from "vitest";
import {
  DEFAULT_MISTAKE_REASON,
  MISTAKE_REASONS,
  MISTAKE_REASONS_SETTING_KEY,
  STRUCTURE_REASONS,
  filterMistakes,
  normalizeReason,
  normalizeSubject,
  reasonCounts,
  resolveMistakeReasons,
  suggestsPrerequisites,
  summarizeMistakes,
  topicCount,
} from "../mistakes";
import type { Mistake } from "../../types";

function makeMistake(partial: Partial<Mistake> & { id: number }): Mistake {
  return {
    subject: "物理",
    title: "题",
    reason: "概念不清",
    correct_note: "",
    is_mastered: 0,
    graph_topic_id: null,
    graph_subject: null,
    graph_topic_name: null,
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

  it("suggests_prerequisites_only_for_structure_reasons", () => {
    // 指向知识结构本身的错因，才值得把人引去看先修关系。
    expect([...STRUCTURE_REASONS]).toEqual(["概念不清", "公式记错", "方法不会"]);
    expect(suggestsPrerequisites("概念不清")).toBe(true);
    expect(suggestsPrerequisites("公式记错")).toBe(true);
    expect(suggestsPrerequisites("方法不会")).toBe(true);

    // 执行层的问题跟知识结构无关，不该往图谱上拽。
    expect(suggestsPrerequisites("审题失误")).toBe(false);
    expect(suggestsPrerequisites("计算失误")).toBe(false);
    expect(suggestsPrerequisites("粗心大意")).toBe(false);
    expect(suggestsPrerequisites("其他")).toBe(false);

    // 未知错因归到「其他」，一样不提示。
    expect(suggestsPrerequisites("瞎写的")).toBe(false);
    expect(suggestsPrerequisites("")).toBe(false);
  });

  it("topic_count_counts_distinct_knowledge_points", () => {
    expect(topicCount([])).toBe(0);
    // 没挂知识点的错题不参与计数。
    expect(topicCount([makeMistake({ id: 1 })])).toBe(0);

    const rows = [
      makeMistake({ id: 1, graph_topic_id: "cnm_001" }),
      makeMistake({ id: 2, graph_topic_id: "cnm_001" }),
      makeMistake({ id: 3, graph_topic_id: "cnm_002" }),
      makeMistake({ id: 4, graph_topic_id: null }),
      // 空白 id 不算挂了知识点。
      makeMistake({ id: 5, graph_topic_id: "   " }),
    ];
    expect(topicCount(rows)).toBe(2);
  });

  it("resolve_mistake_reasons_prefers_the_track_list", () => {
    // 没配置 / 配坏了：回落到内置的那份。
    expect(resolveMistakeReasons([])).toEqual([...MISTAKE_REASONS]);
    expect(resolveMistakeReasons(null)).toEqual([...MISTAKE_REASONS]);
    expect(resolveMistakeReasons(["  "])).toEqual([...MISTAKE_REASONS]);
    // 赛道包覆盖了就用覆盖的。
    expect(resolveMistakeReasons(["精读", " 精读 ", "默写"])).toEqual([
      "精读",
      "默写",
    ]);
  });

  it("setting_key_is_shared_with_the_backend", () => {
    // 前后端读的是同一个 key：Rust 侧 `TRACK_MISTAKE_REASONS_SETTING_KEY`。
    expect(MISTAKE_REASONS_SETTING_KEY).toBe("track.mistake_reasons");
  });

  it("normalize_reason_uses_the_track_whitelist", () => {
    const reasons = ["精读", "默写", "其他"];
    expect(normalizeReason("精读", reasons)).toBe("精读");
    // 不在赛道白名单里的旧错因归到「其他」。
    expect(normalizeReason("审题失误", reasons)).toBe("其他");
    // 白名单里没有「其他」就退到第一项。
    expect(normalizeReason("瞎写的", ["精读", "默写"])).toBe("精读");
  });

  it("reason_counts_use_the_track_whitelist", () => {
    const rows = [
      makeMistake({ id: 1, reason: "精读" }),
      makeMistake({ id: 2, reason: "精读" }),
      makeMistake({ id: 3, reason: "审题失误" }),
    ];
    const counts = reasonCounts(rows, ["精读", "默写", "其他"]);
    expect(counts[0]).toEqual({ reason: "精读", count: 2 });
    expect(counts).toContainEqual({ reason: "其他", count: 1 });
  });
});