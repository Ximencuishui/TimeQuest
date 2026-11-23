import { describe, expect, it } from "vitest";
import { resolveMethods, resolveMotivations, resolveSubjects } from "../content";
import {
  FALLBACK_METHODS,
  FALLBACK_MISTAKE_REASONS,
  FALLBACK_MOTIVATIONS,
  FALLBACK_SUBJECTS,
} from "../fallbacks";
import type { Subject } from "../../types";

function subject(label: string, id: number): Subject {
  return {
    id,
    key: `key_${id}`,
    label,
    fullMark: 100,
    goal: 100,
    unit: "分",
    orderIndex: id - 1,
    trackId: 1,
  };
}

describe("content lib", () => {
  it("subjects_fall_back_when_the_track_has_none", () => {
    expect(resolveSubjects([])).toEqual([...FALLBACK_SUBJECTS]);
    expect(resolveSubjects(null)).toEqual([...FALLBACK_SUBJECTS]);
    expect(resolveSubjects(undefined)).toEqual([...FALLBACK_SUBJECTS]);
  });

  it("subjects_come_from_the_track_and_keep_other_last", () => {
    const resolved = resolveSubjects([subject("英语", 1), subject("数学", 2)]);
    expect(resolved).toEqual(["英语", "数学", "其他"]);
  });

  it("subjects_do_not_duplicate_other", () => {
    const resolved = resolveSubjects([
      subject("数学", 1),
      subject("其他", 2),
      subject("英语", 3),
    ]);
    expect(resolved.filter((item) => item === "其他")).toHaveLength(1);
    expect(resolved[0]).toBe("数学");
  });

  it("methods_fall_back_and_dedupe", () => {
    expect(resolveMethods([])).toEqual([...FALLBACK_METHODS]);
    expect(resolveMethods(null)).toEqual([...FALLBACK_METHODS]);
    expect(resolveMethods(["精读", " 精读 ", "默写"])).toEqual(["精读", "默写"]);
    expect(resolveMethods(["  "])).toEqual([...FALLBACK_METHODS]);
  });

  it("motivations_fall_back_and_dedupe", () => {
    expect(resolveMotivations([])).toEqual([...FALLBACK_MOTIVATIONS]);
    expect(resolveMotivations(["加油", "加油"])).toEqual(["加油"]);
    expect(resolveMotivations([" "])).toEqual([...FALLBACK_MOTIVATIONS]);
  });

  it("fallback_reasons_match_the_builtin_whitelist", () => {
    // 与 Rust `REASON_WHITELIST` 一一对应（Rust 侧有护栏测试反向校验本文件）。
    expect([...FALLBACK_MISTAKE_REASONS]).toEqual([
      "概念不清",
      "公式记错",
      "审题失误",
      "计算失误",
      "方法不会",
      "粗心大意",
      "其他",
    ]);
  });
});
