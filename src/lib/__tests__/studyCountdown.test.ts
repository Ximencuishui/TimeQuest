import { describe, expect, it } from "vitest";
import { calculateTodayRemainingMinutes, resolveRemainingStudy } from "../studyCountdown";

describe("calculateTodayRemainingMinutes", () => {
  it("calculate_today_remaining_minutes_sums_planned_sessions", () => {
    expect(
      calculateTodayRemainingMinutes([
        { status: "planned", start_time: "09:00", end_time: "10:00" },
        { status: "planned", start_time: "14:00", end_time: "14:30" },
      ]),
    ).toBe(90);
  });

  it("calculate_today_remaining_minutes_ignores_done", () => {
    expect(
      calculateTodayRemainingMinutes([
        { status: "planned", start_time: "09:00", end_time: "10:00" },
        { status: "done", start_time: "10:00", end_time: "12:00" },
        { status: "planned", start_time: "14:00", end_time: "14:30" },
      ]),
    ).toBe(90);
  });

  it("resolve_remaining_study_counts_down_the_current_session", () => {
    const now = new Date(2026, 10, 6, 19, 15, 0);
    const view = resolveRemainingStudy(
      [
        { status: "planned", start_time: "19:00", end_time: "20:00", task_title: "英语必修一" },
        { status: "planned", start_time: "20:10", end_time: "21:10", task_title: "数学必修一" },
      ],
      now,
    );
    expect(view).toMatchObject({
      kind: "active",
      title: "英语必修一",
      plannedMinutes: 120,
      seconds: 45 * 60,
    });
  });

  it("resolve_remaining_study_counts_down_to_the_next_session", () => {
    const now = new Date(2026, 10, 6, 16, 46, 0);
    const view = resolveRemainingStudy(
      [
        { status: "done", start_time: "08:40", end_time: "09:40", task_title: "物理必修一" },
        { status: "planned", start_time: "19:00", end_time: "20:00", task_title: "英语必修一" },
        { status: "planned", start_time: "20:10", end_time: "21:10", task_title: "数学必修一" },
      ],
      now,
    );
    expect(view).toMatchObject({
      kind: "upcoming",
      title: "英语必修一",
      plannedMinutes: 120,
      seconds: 2 * 3600 + 14 * 60,
    });
  });

  it("resolve_remaining_study_is_done_when_nothing_is_planned", () => {
    const now = new Date(2026, 10, 6, 21, 30, 0);
    expect(
      resolveRemainingStudy(
        [{ status: "done", start_time: "19:00", end_time: "20:00", task_title: "英语必修一" }],
        now,
      ),
    ).toEqual({ kind: "done" });
  });
});
