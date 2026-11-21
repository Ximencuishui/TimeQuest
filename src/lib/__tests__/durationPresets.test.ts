import { describe, expect, it } from "vitest";
import {
  DEFAULT_DURATION_PRESETS,
  DEFAULT_POMODORO_PLAN,
  buildPomodoroDurations,
  diffDurationPresets,
  formatDurationPresetLabel,
  isValidDurationPreset,
  newDurationPresetId,
  parseDurationPresets,
  parsePomodoroPlan,
  serializeDurationPresets,
  serializePomodoroPlan,
  type DurationPreset,
} from "../durationPresets";

describe("durationPresets 纯逻辑", () => {
  it("duration_presets_defaults_follow_the_pomodoro_algorithm", () => {
    expect(DEFAULT_DURATION_PRESETS.map((preset) => preset.minutes)).toEqual([
      25, 55, 85, 115, 130,
    ]);
    expect(DEFAULT_DURATION_PRESETS.map((preset) => preset.label)).toEqual([
      "番茄 1",
      "番茄 2",
      "番茄 3",
      "番茄 4",
      "整轮（4 番茄 + 长休息）",
    ]);
  });

  it("duration_presets_pomodoro_generator_honors_custom_params", () => {
    const generated = buildPomodoroDurations({
      focusMinutes: 30,
      breakMinutes: 10,
      longBreakMinutes: 20,
      roundsBeforeLongBreak: 2,
    });
    // 30 / 30+10+30=70 / 70+20=90
    expect(generated.map((preset) => preset.minutes)).toEqual([30, 70, 90]);
    expect(generated[2].label).toBe("整轮（2 番茄 + 长休息）");
  });

  it("duration_presets_parse_falls_back_to_defaults_when_broken", () => {
    expect(parseDurationPresets(null).map((p) => p.minutes)).toEqual([25, 55, 85, 115, 130]);
    expect(parseDurationPresets("").map((p) => p.minutes)).toEqual([25, 55, 85, 115, 130]);
    expect(parseDurationPresets("{oops").map((p) => p.minutes)).toEqual([25, 55, 85, 115, 130]);
    expect(parseDurationPresets('{"a":1}').map((p) => p.minutes)).toEqual([25, 55, 85, 115, 130]);
  });

  it("duration_presets_parse_keeps_empty_list_and_drops_invalid_rows", () => {
    expect(parseDurationPresets("[]")).toEqual([]);
    const parsed = parseDurationPresets(
      JSON.stringify([
        { id: "a", label: "番茄", minutes: 25 },
        { id: "b", label: "", minutes: 30 },
        { id: "c", label: "坏时长", minutes: 0 },
        { id: "d", label: "超长", minutes: 5000 },
      ]),
    );
    expect(parsed).toEqual([{ id: "a", label: "番茄", minutes: 25 }]);
  });

  it("duration_presets_serialize_round_trips", () => {
    const list: DurationPreset[] = [{ id: "x", label: "番茄 1", minutes: 25 }];
    expect(parseDurationPresets(serializeDurationPresets(list))).toEqual(list);
  });

  it("duration_presets_diff_reports_only_minute_changes", () => {
    const oldList: DurationPreset[] = [
      { id: "a", label: "番茄 1", minutes: 25 },
      { id: "b", label: "番茄 2", minutes: 55 },
    ];
    const newList: DurationPreset[] = [
      { id: "a", label: "番茄 1", minutes: 30 },
      { id: "b", label: "番茄 2", minutes: 55 },
    ];
    expect(diffDurationPresets(oldList, newList)).toEqual([
      { fromMinutes: 25, toMinutes: 30 },
    ]);
  });

  it("duration_presets_diff_ignores_label_only_edits", () => {
    const oldList: DurationPreset[] = [{ id: "a", label: "番茄 1", minutes: 25 }];
    const newList: DurationPreset[] = [{ id: "a", label: "早读", minutes: 25 }];
    expect(diffDurationPresets(oldList, newList)).toEqual([]);
  });

  it("duration_presets_diff_ignores_added_and_removed_presets", () => {
    const oldList: DurationPreset[] = [{ id: "a", label: "番茄 1", minutes: 25 }];
    const newList: DurationPreset[] = [
      { id: "a", label: "番茄 1", minutes: 25 },
      { id: "c", label: "新的", minutes: 90 },
    ];
    expect(diffDurationPresets(oldList, newList)).toEqual([]);
  });

  it("duration_presets_diff_drops_ambiguous_duplicate_durations", () => {
    const oldList: DurationPreset[] = [
      { id: "a", label: "甲", minutes: 60 },
      { id: "b", label: "乙", minutes: 60 },
    ];
    const newList: DurationPreset[] = [
      { id: "a", label: "甲", minutes: 45 },
      { id: "b", label: "乙", minutes: 90 },
    ];
    // 同一个旧时长被指向两个新时长：整段放弃，宁可不动也不乱改。
    expect(diffDurationPresets(oldList, newList)).toEqual([]);
  });

  it("duration_presets_validate_minutes_range", () => {
    expect(isValidDurationPreset({ label: "番茄", minutes: 25 })).toBe(true);
    expect(isValidDurationPreset({ label: "", minutes: 25 })).toBe(false);
    expect(isValidDurationPreset({ label: "番茄", minutes: 0 })).toBe(false);
    expect(isValidDurationPreset({ label: "番茄", minutes: 5000 })).toBe(false);
  });

  it("duration_presets_new_id_does_not_collide", () => {
    const existing: DurationPreset[] = [{ id: "dp-custom-1", label: "x", minutes: 10 }];
    expect(newDurationPresetId(existing)).toBe("dp-custom-2");
  });

  it("duration_presets_format_label_reads_in_chinese", () => {
    expect(formatDurationPresetLabel({ id: "a", label: "番茄 1", minutes: 25 })).toBe(
      "番茄 1 · 25 分钟",
    );
    expect(formatDurationPresetLabel({ id: "b", label: "整块", minutes: 60 })).toBe(
      "整块 · 1 小时",
    );
  });

  it("duration_presets_pomodoro_plan_round_trips_and_falls_back", () => {
    const plan = { ...DEFAULT_POMODORO_PLAN, focusMinutes: 30 };
    expect(parsePomodoroPlan(serializePomodoroPlan(plan))).toEqual(plan);
    expect(parsePomodoroPlan(null)).toEqual(DEFAULT_POMODORO_PLAN);
    expect(parsePomodoroPlan("nope")).toEqual(DEFAULT_POMODORO_PLAN);
  });

  it("duration_presets_generator_drops_durations_over_one_day", () => {
    // 参数拉太大时一天的时长排不下：不生成那几段，
    // 生成一版存不下来的时长只会让用户白改一遍。
    const generated = buildPomodoroDurations({
      focusMinutes: 180,
      breakMinutes: 60,
      longBreakMinutes: 120,
      roundsBeforeLongBreak: 12,
    });
    expect(generated.map((preset) => preset.minutes)).toEqual([
      180, 420, 660, 900, 1140, 1380,
    ]);
    expect(generated.every((preset) => preset.minutes <= 1440)).toBe(true);
  });

  it("duration_presets_parse_deduplicates_ids", () => {
    // 缺 id 的行拿到兜底 id，理论上可能和显式写的 id 撞车：
    // 撞上了要加后缀，不然两行被当成同一行，diff 时会漏掉一次改动。
    const parsed = parseDurationPresets(
      JSON.stringify([
        { id: "dp-1", label: "甲", minutes: 25 },
        { label: "乙", minutes: 55 },
      ]),
    );
    expect(parsed.map((preset) => preset.id)).toEqual(["dp-1", "dp-1-2"]);
  });
});
