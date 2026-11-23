import { describe, expect, it } from "vitest";
import { GAOKAO_DATE_RULE, gaokaoDateForGrade, resolveDateRule } from "../examDate";

describe("gaokaoDateForGrade", () => {
  const november = new Date(2026, 10, 6, 12, 0, 0);

  it("gaokao_date_after_june_adds_a_year_for_each_grade", () => {
    expect(gaokaoDateForGrade("高一", november)).toBe("2029-06-07");
    expect(gaokaoDateForGrade("高二", november)).toBe("2028-06-07");
    expect(gaokaoDateForGrade("高三", november)).toBe("2027-06-07");
  });

  it("gaokao_date_on_june_7_still_uses_this_years_exam", () => {
    const examMorning = new Date(2026, 5, 7, 8, 0, 0);
    expect(gaokaoDateForGrade("高三", examMorning)).toBe("2026-06-07");
    expect(gaokaoDateForGrade("高二", examMorning)).toBe("2027-06-07");
    expect(gaokaoDateForGrade("高一", examMorning)).toBe("2028-06-07");
  });

  it("gaokao_date_before_june_keeps_the_base_offset", () => {
    const january = new Date(2026, 0, 15, 9, 0, 0);
    expect(gaokaoDateForGrade("高三", january)).toBe("2026-06-07");
    expect(gaokaoDateForGrade("高二", january)).toBe("2027-06-07");
    expect(gaokaoDateForGrade("高一", january)).toBe("2028-06-07");
  });
});

describe("resolveDateRule", () => {
  const november = new Date(2026, 10, 6, 12, 0, 0);

  it("reads_the_gaokao_rule_from_the_track_package_data", () => {
    expect(GAOKAO_DATE_RULE.anchor).toBe("06-07");
    expect(GAOKAO_DATE_RULE.grade_offsets).toEqual({ 高一: 2, 高二: 1, 高三: 0 });
    expect(resolveDateRule(GAOKAO_DATE_RULE, "高三", november)).toBe("2027-06-07");
  });

  it("works_for_any_anchor_and_grade_offset", () => {
    const rule = {
      id: "kaoyan-december",
      anchor: "12-20",
      grade_offsets: { 高一: 2, 高二: 1, 高三: 0 },
    };
    expect(resolveDateRule(rule, "高三", november)).toBe("2026-12-20");
    expect(resolveDateRule(rule, "高一", november)).toBe("2028-12-20");
  });

  it("rolls_to_the_next_year_once_the_anchor_has_passed", () => {
    const rule = { id: "x", anchor: "01-10" };
    expect(resolveDateRule(rule, null, november)).toBe("2027-01-10");
    // 锚点当天仍然算今年。
    const anchorDay = new Date(2026, 0, 10, 8, 0, 0);
    expect(resolveDateRule(rule, null, anchorDay)).toBe("2026-01-10");
  });

  it("returns_an_empty_string_for_a_broken_anchor", () => {
    expect(resolveDateRule({ id: "x", anchor: "not-a-date" }, null, november)).toBe("");
  });
});
