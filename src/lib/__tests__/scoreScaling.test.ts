import { describe, expect, it } from "vitest";
import { examScoreBreakdown, scaledTotalNote, totalFullMarks } from "../scoreScaling";
import type { Subject } from "../../types";
import { SUBJECT_FIXTURES, examSession } from "../../test/subjectFixtures";

type Scores = [
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];

function sitting(scores: Scores) {
  return examSession(1, "月考", "2026-11-01", scores);
}

describe("score scaling", () => {
  it("full_paper_needs_no_scaling", () => {
    const breakdown = examScoreBreakdown(
      sitting([118, 135, 118, 82, 80, 80]),
      SUBJECT_FIXTURES,
    );
    expect(breakdown.missing).toHaveLength(0);
    expect(breakdown.sum).toBe(613);
    expect(breakdown.takenFullMarks).toBe(750);
    expect(breakdown.scaledTotal).toBe(613);
    expect(
      scaledTotalNote(sitting([118, 135, 118, 82, 80, 80]), SUBJECT_FIXTURES),
    ).toBeNull();
  });

  it("missing_biology_scales_the_total_to_the_six_subject_scale", () => {
    const session = sitting([110, 130, 115, 70, 75, null]);

    const breakdown = examScoreBreakdown(session, SUBJECT_FIXTURES);

    expect(breakdown.missing.map((m) => m.label)).toEqual(["生物"]);
    expect(breakdown.sum).toBe(500);
    // 已考科目满分：语文 150 + 数学 150 + 英语 150 + 物理 100 + 化学 100
    expect(breakdown.takenFullMarks).toBe(650);
    expect(breakdown.scaledTotal).toBe(577);
    expect(breakdown.rate).toBeCloseTo(500 / 650);
    expect(scaledTotalNote(session, SUBJECT_FIXTURES)).toBe("实考 500 / 650 · 折算 577 / 750");
  });

  it("several_missing_subjects_scale_by_the_taken_share", () => {
    const breakdown = examScoreBreakdown(
      sitting([110, 130, 115, null, null, null]),
      SUBJECT_FIXTURES,
    );
    expect(breakdown.missing.map((m) => m.label)).toEqual([
      "物理",
      "化学",
      "生物",
    ]);
    expect(breakdown.takenFullMarks).toBe(450);
    expect(breakdown.scaledTotal).toBe(592);
  });

  it("a_single_subject_is_not_scaled", () => {
    const session = sitting([null, 135, null, null, null, null]);
    const breakdown = examScoreBreakdown(session, SUBJECT_FIXTURES);
    expect(breakdown.filled).toHaveLength(1);
    expect(scaledTotalNote(session, SUBJECT_FIXTURES)).toBeNull();
  });

  it("an_empty_paper_has_no_scaled_total", () => {
    const session = sitting([null, null, null, null, null, null]);
    const breakdown = examScoreBreakdown(session, SUBJECT_FIXTURES);
    expect(breakdown.scaledTotal).toBeNull();
    expect(breakdown.sum).toBe(0);
    expect(breakdown.rate).toBe(0);
    expect(scaledTotalNote(session, SUBJECT_FIXTURES)).toBeNull();
  });

  it("total_full_marks_come_from_the_subject_list", () => {
    expect(totalFullMarks(SUBJECT_FIXTURES)).toBe(750);
  });

  it("scales_against_a_four_subject_paper", () => {
    const four: Subject[] = SUBJECT_FIXTURES.slice(0, 4);
    // 语文 150 + 数学 150 + 英语 150 + 物理 100 = 550
    const session = examSession(2, "四科考", "2026-11-02", [100, 120, 100, null], four);
    const breakdown = examScoreBreakdown(session, four);
    expect(breakdown.missing.map((m) => m.label)).toEqual(["物理"]);
    expect(breakdown.takenFullMarks).toBe(450);
    expect(breakdown.scaledTotal).toBe(391);
    expect(scaledTotalNote(session, four)).toBe("实考 320 / 450 · 折算 391 / 550");
  });

  it("subjects_without_a_full_mark_do_not_break_the_scaling", () => {
    const noFullMark: Subject[] = [
      { id: 11, key: "a", label: "甲", fullMark: null, goal: null, unit: null, orderIndex: 0, trackId: 1 },
      { id: 12, key: "b", label: "乙", fullMark: 100, goal: 100, unit: "分", orderIndex: 1, trackId: 1 },
      { id: 13, key: "c", label: "丙", fullMark: null, goal: null, unit: null, orderIndex: 2, trackId: 1 },
    ];
    const session = examSession(3, "三科", "2026-11-03", [80, 90, null], noFullMark);
    const breakdown = examScoreBreakdown(session, noFullMark);
    expect(breakdown.missing.map((m) => m.label)).toEqual(["丙"]);
    expect(breakdown.takenFullMarks).toBe(100);
    // 甲、丙没有满分，不进折算的分母。
    expect(breakdown.scaledTotal).toBe(90);
  });

  it("a_scored_subject_without_a_full_mark_does_not_inflate_the_scaled_total", () => {
    const noFullMark: Subject[] = [
      { id: 21, key: "a", label: "甲", fullMark: null, goal: null, unit: null, orderIndex: 0, trackId: 1 },
      { id: 22, key: "b", label: "乙", fullMark: 100, goal: 100, unit: "分", orderIndex: 1, trackId: 1 },
      { id: 23, key: "c", label: "丙", fullMark: null, goal: null, unit: null, orderIndex: 2, trackId: 1 },
    ];
    const session = examSession(4, "三科", "2026-11-04", [80, 90, null], noFullMark);
    const breakdown = examScoreBreakdown(session, noFullMark);

    // 实考总分含甲的 80 分（它确实考了）。
    expect(breakdown.sum).toBe(170);
    // 但甲没有满分基准，不参与折算：分子分母口径一致，折算分不会虚高。
    // 旧口径是 170 × 100 ÷ 100 = 170，等于把甲的 80 分按乙的满分算了一遍。
    expect(breakdown.unscored.map((item) => item.label)).toEqual(["甲"]);
    expect(breakdown.scaledSum).toBe(90);
    expect(breakdown.takenFullMarks).toBe(100);
    expect(breakdown.scaledTotal).toBe(90);
    expect(breakdown.rate).toBeCloseTo(0.9);
    expect(scaledTotalNote(session, noFullMark)).toBe(
      "实考 170 · 折算 90 / 100（甲 未配满分，不参与折算）",
    );
  });
});
