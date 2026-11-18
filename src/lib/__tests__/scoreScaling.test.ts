import { describe, expect, it } from "vitest";
import {
  SUBJECT_FULL_MARKS,
  TOTAL_FULL_MARKS,
  examScoreBreakdown,
  scaledTotalNote,
} from "../scoreScaling";
import type { ExamRecord } from "../../types";

type Scores = [
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];

function sitting(scores: Scores): ExamRecord {
  const [chinese, math, english, physics, chemistry, biology] = scores;
  return {
    id: 1,
    exam_name: "月考",
    exam_date: "2026-11-01",
    chinese_score: chinese,
    math_score: math,
    english_score: english,
    physics_score: physics,
    chemistry_score: chemistry,
    biology_score: biology,
    created_at: "2026-11-01 12:00:00",
  };
}

describe("score scaling", () => {
  it("full_paper_needs_no_scaling", () => {
    const breakdown = examScoreBreakdown(
      sitting([118, 135, 118, 82, 80, 80]),
    );
    expect(breakdown.missing).toHaveLength(0);
    expect(breakdown.sum).toBe(613);
    expect(breakdown.takenFullMarks).toBe(TOTAL_FULL_MARKS);
    expect(breakdown.scaledTotal).toBe(613);
    expect(scaledTotalNote(sitting([118, 135, 118, 82, 80, 80]))).toBeNull();
  });

  it("missing_biology_scales_the_total_to_the_six_subject_scale", () => {
    const record = sitting([110, 130, 115, 70, 75, null]);
    const breakdown = examScoreBreakdown(record);

    expect(breakdown.missing.map((m) => m.label)).toEqual(["生物"]);
    expect(breakdown.sum).toBe(500);
    // 已考科目满分：语文 120 + 数学 130 + 英语 120 + 物理 80 + 化学 80
    expect(breakdown.takenFullMarks).toBe(530);
    expect(breakdown.scaledTotal).toBe(575);
    expect(breakdown.rate).toBeCloseTo(500 / 530);
    expect(scaledTotalNote(record)).toBe("实考 500 / 530 · 折算 575 / 610");
  });

  it("several_missing_subjects_scale_by_the_taken_share", () => {
    const breakdown = examScoreBreakdown(sitting([110, 130, 115, null, null, null]));
    expect(breakdown.missing.map((m) => m.label)).toEqual([
      "物理",
      "化学",
      "生物",
    ]);
    expect(breakdown.takenFullMarks).toBe(370);
    expect(breakdown.scaledTotal).toBe(585);
  });

  it("a_single_subject_is_not_scaled", () => {
    const record = sitting([null, 135, null, null, null, null]);
    const breakdown = examScoreBreakdown(record);
    expect(breakdown.filled).toHaveLength(1);
    expect(scaledTotalNote(record)).toBeNull();
  });

  it("an_empty_paper_has_no_scaled_total", () => {
    const breakdown = examScoreBreakdown(
      sitting([null, null, null, null, null, null]),
    );
    expect(breakdown.scaledTotal).toBeNull();
    expect(breakdown.sum).toBe(0);
    expect(breakdown.rate).toBe(0);
    expect(scaledTotalNote(sitting([null, null, null, null, null, null]))).toBeNull();
  });

  it("subject_full_marks_match_the_default_targets", () => {
    expect(SUBJECT_FULL_MARKS).toEqual({
      chinese: 120,
      math: 130,
      english: 120,
      physics: 80,
      chemistry: 80,
      biology: 80,
    });
    const sum = Object.values(SUBJECT_FULL_MARKS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(TOTAL_FULL_MARKS);
  });
});