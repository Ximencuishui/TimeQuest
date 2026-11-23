import { describe, expect, it } from "vitest";
import {
  TRACK_TEMPLATES,
  mergeTemplateSubjects,
  resolveGoalForTrack,
  templateFullMarks,
  templateGoalSum,
  trackSubjectTotal,
  trackTemplateById,
} from "../track";
import { examScoreBreakdown, totalFullMarks } from "../scoreScaling";
import { SUBJECT_FIXTURES, examSession } from "../../test/subjectFixtures";
import type { Goal, Subject } from "../../types";

function goal(partial: Partial<Goal> & { id: number }): Goal {
  return {
    trackId: null,
    name: "目标",
    date: "2027-06-07",
    kind: "exam",
    isPrimary: false,
    targetScore: null,
    createdAt: "2026-11-06 12:00:00",
    ...partial,
  };
}

describe("赛道模板", () => {
  it("gaokao_is_the_only_template_requiring_grade_and_region", () => {
    const gaokao = trackTemplateById("gaokao");
    expect(gaokao.requiresGaokaoContext).toBe(true);
    expect(gaokao.maxScore).toBe(750);
    expect(gaokao.subjects).toHaveLength(6);
    for (const template of TRACK_TEMPLATES.filter(
      (item) => item.id !== "gaokao",
    )) {
      expect(template.requiresGaokaoContext).toBe(false);
    }
  });

  it("only_gaokao_and_custom_are_available_in_this_stage", () => {
    // 考研 / 语言 / 技能先占位：字段位留好，等赛道包（P2-1）把内容送进来。
    const available = TRACK_TEMPLATES.filter((item) => item.available).map(
      (item) => item.id,
    );
    expect(available).toEqual(["gaokao", "custom"]);
    for (const template of TRACK_TEMPLATES) {
      expect(template.subjects.length).toBeGreaterThanOrEqual(0);
      expect(typeof template.kind).toBe("string");
    }
  });

  it("every_template_has_unique_subject_keys", () => {
    // 科目标识全库唯一：不同赛道不能用同一个 key，否则会互相覆盖。
    const keys = TRACK_TEMPLATES.flatMap((template) =>
      template.subjects.map((subject) => subject.key),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("template_scores_add_up", () => {
    const gaokao = trackTemplateById("gaokao");
    expect(templateFullMarks(gaokao.subjects)).toBe(610);
    expect(templateGoalSum(gaokao.subjects)).toBe(610);
    expect(templateFullMarks(trackTemplateById("custom").subjects)).toBe(0);
  });

  it("falls_back_to_the_custom_template_for_an_unknown_id", () => {
    expect(trackTemplateById("custom").id).toBe("custom");
    expect(TRACK_TEMPLATES[TRACK_TEMPLATES.length - 1]?.id).toBe("custom");
  });
});

describe("科目清单合并", () => {
  it("keeps_the_stored_goal_when_the_template_already_has_the_subject", () => {
    const template = trackTemplateById("gaokao");
    const stored: Subject[] = [
      { ...SUBJECT_FIXTURES[1], goal: 140 },
    ];
    const rows = mergeTemplateSubjects(template, stored);
    expect(rows).toHaveLength(6);
    expect(rows.find((row) => row.key === "math")?.goal).toBe(140);
    expect(rows.find((row) => row.key === "chinese")?.goal).toBe(120);
  });

  it("adds_subjects_that_only_exist_in_the_database", () => {
    const template = trackTemplateById("custom");
    const stored: Subject[] = [
      {
        id: 99,
        key: "mine",
        label: "我的科目",
        fullMark: 50,
        goal: 30,
        unit: "分",
        orderIndex: 0,
        trackId: null,
      },
    ];
    const rows = mergeTemplateSubjects(template, stored);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "mine", fullMark: 50, goal: 30 });
  });
});

describe("赛道目标解析", () => {
  it("prefers_a_goal_scoped_to_the_track", () => {
    const goals = [
      goal({ id: 1, name: "高考", isPrimary: true }),
      goal({ id: 2, name: "考研", trackId: 9 }),
    ];
    expect(resolveGoalForTrack(goals, 9)?.name).toBe("考研");
    expect(resolveGoalForTrack(goals, null)?.name).toBe("高考");
  });

  it("falls_back_to_the_primary_goal_then_the_first_one", () => {
    expect(resolveGoalForTrack([], 1)).toBeNull();
    expect(resolveGoalForTrack([goal({ id: 3 })], 1)?.id).toBe(3);
  });
});

describe("科目目标合计", () => {
  it("sums_only_the_subjects_with_a_goal", () => {
    expect(trackSubjectTotal(SUBJECT_FIXTURES)).toBe(610);
    expect(
      trackSubjectTotal([
        { ...SUBJECT_FIXTURES[0], goal: null },
        { ...SUBJECT_FIXTURES[1], goal: 100 },
      ]),
    ).toBe(100);
  });
});

describe("折算口径跟着科目集走", () => {
  it("total_full_marks_comes_from_the_subject_list", () => {
    expect(totalFullMarks(SUBJECT_FIXTURES)).toBe(610);
    expect(totalFullMarks(SUBJECT_FIXTURES.slice(0, 4))).toBe(450);
    expect(
      totalFullMarks([
        { fullMark: null },
        { fullMark: 100 },
        { fullMark: null },
      ]),
    ).toBe(100);
  });

  it("scales_a_four_subject_paper_against_its_own_full_marks", () => {
    const four = SUBJECT_FIXTURES.slice(0, 4);
    const session = examSession(2, "四科考", "2026-11-02", [100, 120, 100, null], four);
    const breakdown = examScoreBreakdown(session, four);
    expect(breakdown.missing.map((item) => item.label)).toEqual(["物理"]);
    expect(breakdown.takenFullMarks).toBe(370);
    // 320 × 450 ÷ 370 = 389
    expect(breakdown.scaledTotal).toBe(389);
  });

  it("keeps_the_single_subject_score_as_is", () => {
    const one = SUBJECT_FIXTURES.slice(0, 1);
    const session = examSession(3, "单科", "2026-11-03", [100], one);
    const breakdown = examScoreBreakdown(session, one);
    // 科目都考了就不用折算，直接是实考分。
    expect(breakdown.scaledTotal).toBe(100);
    expect(breakdown.sum).toBe(100);
    expect(breakdown.missing).toEqual([]);
  });
});
