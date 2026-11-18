import { describe, expect, it } from "vitest";
import { MAX_DAILY_STUDY_MINUTES } from "../constants";
import {
  calculateTodayRemainingMinutes,
  mergePlannedWindows,
  resolveRemainingStudy,
  summarizeTodayPlan,
} from "../studyCountdown";

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

describe("calculateTodayRemainingMinutes 防呆：去重 + 上限", () => {
  it("calculate_today_remaining_minutes_merges_duplicate_slots", () => {
    // 老毛病：教材导入把 16 场全排在 19:00–20:00，人只能同时学一门。
    expect(
      calculateTodayRemainingMinutes([
        { status: "planned", start_time: "19:00", end_time: "20:00" },
        { status: "planned", start_time: "19:00", end_time: "20:00" },
        { status: "planned", start_time: "19:00", end_time: "20:00" },
      ]),
    ).toBe(60);
  });

  it("calculate_today_remaining_minutes_merges_partial_overlap", () => {
    // 09:00–10:00 与 09:30–10:30 合起来是 09:00–10:30（90 分钟），再加 14:00–14:30。
    expect(
      calculateTodayRemainingMinutes([
        { status: "planned", start_time: "09:00", end_time: "10:00" },
        { status: "planned", start_time: "09:30", end_time: "10:30" },
        { status: "planned", start_time: "14:00", end_time: "14:30" },
      ]),
    ).toBe(120);
  });

  it("calculate_today_remaining_minutes_caps_at_daily_limit", () => {
    const sessions = Array.from({ length: 24 }, (_, hour) => ({
      status: "planned",
      start_time: `${String(hour).padStart(2, "0")}:00`,
      end_time: `${String(hour).padStart(2, "0")}:59`,
    }));
    expect(calculateTodayRemainingMinutes(sessions)).toBe(MAX_DAILY_STUDY_MINUTES);
  });

  it("calculate_today_remaining_minutes_respects_custom_daily_limit", () => {
    const sessions = Array.from({ length: 24 }, (_, hour) => ({
      status: "planned",
      start_time: `${String(hour).padStart(2, "0")}:00`,
      end_time: `${String(hour).padStart(2, "0")}:59`,
    }));
    expect(calculateTodayRemainingMinutes(sessions, 120)).toBe(120);
    expect(summarizeTodayPlan(sessions, 120).capped).toBe(true);
  });

  it("summarize_today_plan_reports_merged_sessions_and_cap", () => {
    const plan = summarizeTodayPlan([
      { status: "planned", start_time: "19:00", end_time: "20:00" },
      { status: "planned", start_time: "19:00", end_time: "20:00" },
      { status: "done", start_time: "08:00", end_time: "09:00" },
    ]);
    expect(plan).toMatchObject({
      mergedMinutes: 60,
      minutes: 60,
      mergedSessions: 1,
      capped: false,
    });
  });

  it("merge_planned_windows_returns_non_overlapping_windows", () => {
    expect(
      mergePlannedWindows([
        { status: "planned", start_time: "09:00", end_time: "10:00" },
        { status: "planned", start_time: "09:30", end_time: "10:30" },
        { status: "planned", start_time: "14:00", end_time: "14:30" },
      ]),
    ).toEqual([
      { start: 540, end: 630 },
      { start: 840, end: 870 },
    ]);
  });

  it("resolve_remaining_study_reports_merged_sessions", () => {
    const now = new Date(2026, 10, 6, 18, 0, 0);
    const view = resolveRemainingStudy(
      [
        { status: "planned", start_time: "19:00", end_time: "20:00", task_title: "英语必修一" },
        { status: "planned", start_time: "19:00", end_time: "20:00", task_title: "数学必修一" },
      ],
      now,
    );
    expect(view).toMatchObject({
      kind: "upcoming",
      plannedMinutes: 60,
      mergedSessions: 1,
      capped: false,
    });
  });
});
