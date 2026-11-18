import { describe, expect, it } from "vitest";
import {
  DURATION_PRESETS,
  HOUR_CHOICES,
  MINUTE_CHOICES,
  TIME_PRESETS,
  addMinutesToHhmm,
  formatDurationLabel,
  formatHhmm,
  parseHhmm,
} from "../timeField";

describe("timeField 纯逻辑", () => {
  it("parse_hhmm_reads_valid_and_rejects_invalid", () => {
    expect(parseHhmm("09:30")).toEqual({ hour: 9, minute: 30 });
    expect(parseHhmm("9:05")).toEqual({ hour: 9, minute: 5 });
    expect(parseHhmm("24:00")).toBeNull();
    expect(parseHhmm("09:61")).toBeNull();
    expect(parseHhmm("abc")).toBeNull();
    expect(parseHhmm("")).toBeNull();
  });

  it("format_hhmm_pads_and_clamps", () => {
    expect(formatHhmm(9, 5)).toBe("09:05");
    expect(formatHhmm(25, 70)).toBe("23:59");
    expect(formatHhmm(-1, -1)).toBe("00:00");
  });

  it("add_minutes_to_hhmm_keeps_clock_valid", () => {
    expect(addMinutesToHhmm("09:00", 90)).toBe("10:30");
    expect(addMinutesToHhmm("23:30", 60)).toBe("23:59");
    expect(addMinutesToHhmm("00:10", -30)).toBe("00:00");
    expect(addMinutesToHhmm("bad", 30)).toBe("00:30");
  });

  it("format_duration_label_reads_in_chinese", () => {
    expect(formatDurationLabel(30)).toBe("30 分钟");
    expect(formatDurationLabel(60)).toBe("1 小时");
    expect(formatDurationLabel(90)).toBe("1 小时 30 分钟");
    expect(formatDurationLabel(0)).toBe("0 分钟");
  });

  it("presets_cover_morning_afternoon_and_evening", () => {
    const starts = TIME_PRESETS.map((preset) => preset.start);
    expect(starts).toContain("07:00");
    expect(starts).toContain("14:00");
    expect(starts).toContain("19:00");
    // 每个预置时段自身都是合法的（结束不早于开始）。
    for (const preset of TIME_PRESETS) {
      const start = parseHhmm(preset.start);
      const end = parseHhmm(preset.end);
      expect(start).not.toBeNull();
      expect(end).not.toBeNull();
      expect(end!.hour * 60 + end!.minute).toBeGreaterThan(
        start!.hour * 60 + start!.minute,
      );
    }
  });

  it("hour_and_minute_choices_are_in_school_day_range", () => {
    expect(HOUR_CHOICES[0]).toBe(6);
    expect(HOUR_CHOICES[HOUR_CHOICES.length - 1]).toBe(22);
    expect([...MINUTE_CHOICES]).toEqual([0, 15, 30, 45]);
    expect([...DURATION_PRESETS]).toContain(90);
  });
});
