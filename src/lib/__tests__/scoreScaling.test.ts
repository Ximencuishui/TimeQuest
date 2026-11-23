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
    expect(breakdown.takenFullMarks).toBe(610);
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
    // 已考科目满分：语文 120 + 数学 130 + 英语 120 + 物理 80 + 化学 80
    expect(breakdown.takenFullMarks).toBe(530);
    expect(breakdown.scaledTotal).toBe(575);
    expect(breakdown.rate).toBeCloseTo(500 / 530);
    expect(scaledTotalNote(session, SUBJECT_FIXTURES)).toBe("实考 500 / 530 · 折算 575 / 610");
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
    expect(breakdown.takenFullMarks).toBe(370);
    expect(breakdown.scaledTotal).toBe(585);
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
    expect(totalFullMarks(SUBJECT_FIXTURES)).toBe(610);
  });

  it("scales_against_a_four_subject_paper", () => {
    const four: Subject[] = SUBJECT_FIXTURES.slice(0, 4);
    // 语文 120 + 数学 130 + 英语 120 + 物理 80 = 450
    const session = examSession(2, "四科考", "2026-11-02", [100, 120, 100, null], four);
    const breakdown = examScoreBreakdown(session, four);
    expect(breakdown.missing.map((m) => m.label)).toEqual(["物理"]);
    expect(breakdown.takenFullMarks).toBe(370);
    expect(breakdown.scaledTotal).toBe(389);
    expect(scaledTotalNote(session, four)).toBe("实考 320 / 370 · 折算 389 / 450");
  });

  it("subjects_without_a_full_mark_do_not_break_the_scaling", () => {
    const noFullMark: Subject[] = [
      { id: 11, key: "a", label: "甲", fullMark: null, goal: null, unit: null, orderIndex: 0 },
      { id: 12, key: "b", label: "乙", fullMark: 100, goal: 100, unit: "分", orderIndex: 1 },
      { id: 13, key: "c", label: "丙", fullMark: null, goal: null, unit: null, orderIndex: 2 },
    ];
    const session = examSession(3, "三科", "2026-11-03", [80, 90, null], noFullMark);
    const breakdown = examScoreBreakdown(session, noFullMark);
    expect(breakdown.missing.map((m) => m.label)).toEqual(["丙"]);
    expect(breakdown.takenFullMarks).toBe(100);
    // 甲、丙没有满分，不进折算的分母。
    expect(breakdown.scaledTotal).toBe(170);
  });
});
