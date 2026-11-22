import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_PRESETS,
  diffTimePresets,
  formatTimePresetLabel,
  isValidTimePreset,
  newTimePresetId,
  parseTimePresets,
  serializeTimePresets,
  summarizeTimeShift,
  type TimePreset,
} from "../timePresets";

const pmPreset: TimePreset = {
  id: "tp-pm-1",
  label: "下午",
  start: "14:00",
  end: "15:00",
};

describe("timePresets 常用时段", () => {
  it("presets_cover_morning_afternoon_and_evening", () => {
    const starts = DEFAULT_TIME_PRESETS.map((preset) => preset.start);
    expect(starts).toContain("07:00");
    expect(starts).toContain("14:00");
    expect(starts).toContain("19:00");
    // 每个预置时段自身都是合法的（结束不早于开始）。
    for (const preset of DEFAULT_TIME_PRESETS) {
      expect(isValidTimePreset(preset)).toBe(true);
    }
  });

  it("time_presets_parse_falls_back_to_defaults_when_broken", () => {
    expect(parseTimePresets(null)).toHaveLength(DEFAULT_TIME_PRESETS.length);
    expect(parseTimePresets("")).toHaveLength(DEFAULT_TIME_PRESETS.length);
    expect(parseTimePresets("not json")).toHaveLength(DEFAULT_TIME_PRESETS.length);
    expect(parseTimePresets("{}")).toHaveLength(DEFAULT_TIME_PRESETS.length);
  });

  it("time_presets_parse_keeps_empty_list_and_drops_invalid_rows", () => {
    // 用户把预设全删了：这是合法的空列表，不能偷偷塞回默认值。
    expect(parseTimePresets("[]")).toEqual([]);

    const parsed = parseTimePresets(
      JSON.stringify([
        { id: "a", label: "早读", start: "07:00", end: "08:00" },
        { id: "b", label: "", start: "09:00", end: "10:00" },
        { id: "c", label: "坏的", start: "10:00", end: "09:00" },
        { id: "d", label: "坏的", start: "abc", end: "10:00" },
      ]),
    );
    expect(parsed).toEqual([
      { id: "a", label: "早读", start: "07:00", end: "08:00" },
    ]);
  });

  it("time_presets_round_trip_serialize", () => {
    const list = [pmPreset, { id: "x", label: " 自定义 ", start: "20:00", end: "21:00" }];
    const parsed = parseTimePresets(serializeTimePresets(list));
    expect(parsed).toEqual([
      pmPreset,
      { id: "x", label: "自定义", start: "20:00", end: "21:00" },
    ]);
  });

  it("time_presets_diff_reports_only_time_changes", () => {
    const changes = diffTimePresets(
      [pmPreset],
      [{ ...pmPreset, start: "15:00", end: "16:00" }],
    );
    expect(changes).toEqual([
      { fromStart: "14:00", fromEnd: "15:00", toStart: "15:00", toEnd: "16:00" },
    ]);
  });

  it("time_presets_diff_ignores_label_only_edits", () => {
    // 只改名字不动时间：不该惊动任何已排的场次。
    const changes = diffTimePresets(
      [pmPreset],
      [{ ...pmPreset, label: "傍晚" }],
    );
    expect(changes).toEqual([]);
  });

  it("time_presets_diff_ignores_added_and_removed_presets", () => {
    const added: TimePreset = { id: "new", label: "新增", start: "12:00", end: "13:00" };
    expect(diffTimePresets([pmPreset], [pmPreset, added])).toEqual([]);
    expect(diffTimePresets([pmPreset, added], [pmPreset])).toEqual([]);
  });

  it("time_presets_diff_drops_ambiguous_duplicate_ranges", () => {
    // 两个预设改了时间却落到同一个旧时段：不知道该挪到哪，整段放弃。
    const changes = diffTimePresets(
      [
        { id: "a", label: "甲", start: "14:00", end: "15:00" },
        { id: "b", label: "乙", start: "14:00", end: "15:00" },
      ],
      [
        { id: "a", label: "甲", start: "15:00", end: "16:00" },
        { id: "b", label: "乙", start: "16:00", end: "17:00" },
      ],
    );
    expect(changes).toEqual([]);
  });

  it("time_presets_diff_keeps_same_target_for_duplicate_ranges", () => {
    // 两个预设挪到同一个新时段：结果一致，不算歧义。
    const changes = diffTimePresets(
      [
        { id: "a", label: "甲", start: "14:00", end: "15:00" },
        { id: "b", label: "乙", start: "14:00", end: "15:00" },
      ],
      [
        { id: "a", label: "甲", start: "15:00", end: "16:00" },
        { id: "b", label: "乙", start: "15:00", end: "16:00" },
      ],
    );
    expect(changes).toEqual([
      { fromStart: "14:00", fromEnd: "15:00", toStart: "15:00", toEnd: "16:00" },
    ]);
  });

  it("new_time_preset_id_avoids_duplicates", () => {
    const first = newTimePresetId([pmPreset]);
    const second = newTimePresetId([pmPreset, { ...pmPreset, id: first }]);
    expect(first).not.toBe(second);
    expect(second).not.toBe(pmPreset.id);
  });

  it("format_time_preset_label_shows_name_and_range", () => {
    expect(formatTimePresetLabel(pmPreset)).toBe("下午 14:00–15:00");
  });

  it("time_presets_parse_deduplicates_ids", () => {
    // 缺 id 的行拿到兜底 id，理论上可能和显式写的 id 撞车：
    // 撞上了要加后缀，不然两行被当成同一行，diff 时会漏掉一次改动。
    const parsed = parseTimePresets(
      JSON.stringify([
        { id: "tp-1", label: "甲", start: "07:00", end: "08:00" },
        { label: "乙", start: "09:00", end: "10:00" },
      ]),
    );
    expect(parsed.map((preset) => preset.id)).toEqual(["tp-1", "tp-1-2"]);
  });

  it("summarize_time_shift_reports_moved_and_conflicting_counts", () => {
    expect(summarizeTimeShift({ matched: 3, updated: 3, conflicts: 0 })).toBe(
      "已保存，3 场排期已挪到新的常用时段。",
    );
    // 撞车保持原样的那几场也要说出来，不能只报挪走的。
    expect(summarizeTimeShift({ matched: 5, updated: 3, conflicts: 2 })).toBe(
      "已保存，3 场排期已挪到新的常用时段；2 场撞车保持原样。",
    );
    expect(summarizeTimeShift({ matched: 2, updated: 0, conflicts: 2 })).toBe(
      "已保存；2 场排期挪过去会撞车，保持原样。",
    );
    expect(summarizeTimeShift({ matched: 0, updated: 0, conflicts: 0 })).toBe("已保存。");
  });
});