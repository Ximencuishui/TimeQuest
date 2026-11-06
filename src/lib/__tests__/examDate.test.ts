import { describe, expect, it } from "vitest";
import { gaokaoDateForGrade } from "../examDate";

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
