import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  daysBetween,
  monthGridIso,
  monthKey,
  monthLabelZh,
  nextMondayIso,
  relativeDayLabel,
  shiftMonthIso,
  shortDateLabel,
  weekdayLabel,
} from "../dateField";

describe("dateField 纯逻辑", () => {
  it("weekday_label_starts_on_monday", () => {
    expect(weekdayLabel("2026-11-16")).toBe("周一");
    expect(weekdayLabel("2026-11-18")).toBe("周三");
    expect(weekdayLabel("2026-11-22")).toBe("周日");
    expect(weekdayLabel("bad")).toBe("");
  });

  it("short_date_label_drops_year", () => {
    expect(shortDateLabel("2026-11-18")).toBe("11月18日");
    expect(shortDateLabel("bad")).toBe("bad");
  });

  it("relative_day_label_covers_today_tomorrow_after_tomorrow", () => {
    expect(relativeDayLabel("2026-11-18", "2026-11-18")).toBe("今天");
    expect(relativeDayLabel("2026-11-19", "2026-11-18")).toBe("明天");
    expect(relativeDayLabel("2026-11-20", "2026-11-18")).toBe("后天");
    expect(relativeDayLabel("2026-11-21", "2026-11-18")).toBeNull();
  });

  it("days_between_counts_calendar_days", () => {
    expect(daysBetween("2026-11-18", "2026-11-21")).toBe(3);
    expect(daysBetween("2026-11-21", "2026-11-18")).toBe(-3);
    expect(daysBetween("bad", "2026-11-18")).toBeNull();
  });

  it("add_days_iso_crosses_month_boundary", () => {
    expect(addDaysIso("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("bad", 1)).toBe("bad");
  });

  it("next_monday_never_returns_today", () => {
    // 2026-11-18 是周三。
    expect(nextMondayIso("2026-11-18")).toBe("2026-11-23");
    // 周一本身 → 下周一。
    expect(nextMondayIso("2026-11-16")).toBe("2026-11-23");
    // 周日 → 次日周一。
    expect(nextMondayIso("2026-11-22")).toBe("2026-11-23");
  });

  it("month_key_and_label_read_in_chinese", () => {
    expect(monthKey("2026-11-18")).toBe("2026-11");
    expect(monthLabelZh("2026-11")).toBe("2026年11月");
  });

  it("month_grid_fills_whole_weeks_from_monday", () => {
    const grid = monthGridIso("2026-11");
    expect(grid.length % 7).toBe(0);
    expect(grid[0]).toBe("2026-10-26");
    expect(grid).toContain("2026-11-01");
    expect(grid).toContain("2026-11-30");
    expect(grid[grid.length - 1]).toBe("2026-12-06");
  });

  it("shift_month_moves_across_year", () => {
    expect(shiftMonthIso("2026-11", 1)).toBe("2026-12");
    expect(shiftMonthIso("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthIso("2026-01", -1)).toBe("2025-12");
  });
});
