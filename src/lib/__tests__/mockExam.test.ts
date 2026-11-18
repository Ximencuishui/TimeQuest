import { describe, expect, it } from "vitest";
import { nextMockExam } from "../mockExam";
import type { ExamTarget } from "../../types";

const gaokao: ExamTarget = {
  id: "gaokao",
  name: "高考",
  date: "2027-06-07",
  isPrimary: true,
};

function exam(
  id: string,
  name: string,
  date: string,
  isPrimary = false,
): ExamTarget {
  return { id, name, date, isPrimary };
}

describe("模考倒计时", () => {
  it("mock_exam_picks_the_nearest_future_non_primary_exam", () => {
    const mock = nextMockExam(
      [
        gaokao,
        exam("m2", "第二次模考", "2027-04-20"),
        exam("m1", "第一次模考", "2027-03-10"),
      ],
      "2026-11-18",
    );

    expect(mock).not.toBeNull();
    expect(mock!.name).toBe("第一次模考");
    expect(mock!.daysLeft).toBe(112);
  });

  it("mock_exam_ignores_the_primary_exam", () => {
    const mock = nextMockExam([gaokao], "2026-11-18");
    expect(mock).toBeNull();
  });

  it("mock_exam_ignores_past_exams", () => {
    const mock = nextMockExam(
      [gaokao, exam("m1", "第一次模考", "2026-10-20")],
      "2026-11-18",
    );
    expect(mock).toBeNull();
  });

  it("mock_exam_marks_today_as_is_today", () => {
    const mock = nextMockExam(
      [gaokao, exam("m1", "一模", "2026-11-18")],
      "2026-11-18",
    );
    expect(mock!.isToday).toBe(true);
    expect(mock!.daysLeft).toBe(0);
  });

  it("mock_exam_returns_null_without_any_exam", () => {
    expect(nextMockExam([], "2026-11-18")).toBeNull();
  });
});
