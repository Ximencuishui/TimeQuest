import { describe, expect, it } from "vitest";
import {
  generateLearningReport,
  REPORT_CLOSINGS,
  type ReportData,
} from "../reportGenerator";

const scenarioA: ReportData = {
  range: "week",
  totalMinutes: 11 * 60,
  totalUnits: 8,
  subjects: [
    { subject: "数学", minutes: 10 * 60 },
    { subject: "英语", minutes: 60 },
  ],
  comparisons: [
    { subject: "数学", plannedMinutes: 10 * 60, actualMinutes: 10 * 60 },
    { subject: "英语", plannedMinutes: 5 * 60, actualMinutes: 60 },
  ],
  currentStreak: 4,
  longestStreak: 9,
};

const emptyWeek: ReportData = {
  range: "week",
  totalMinutes: 0,
  totalUnits: 0,
  subjects: [],
  comparisons: [],
  currentStreak: 0,
  longestStreak: 0,
};

function plain(text: string): string {
  return text.replace(/\*\*/g, "");
}

describe("generateLearningReport", () => {
  it("report_highlights_focus_subject_and_warns_on_large_gap", () => {
    const text = generateLearningReport(scenarioA);
    const readable = plain(text);

    expect(readable).toContain("数学依然是你最专注的阵地");
    expect(readable).toContain("注意");
    expect(readable).toContain("英语");
    expect(readable).toContain("排了 5 小时，实际只完成了 1 小时");
    expect(readable).toContain("目前你已连续打卡 4 天，千万别让小火苗灭了！");
    expect(readable).toContain("最长纪录是 9 天");
    expect(text).toContain("**数学**");
    expect(REPORT_CLOSINGS.some((line) => text.endsWith(line))).toBe(true);
    expect(generateLearningReport(scenarioA)).toBe(text);
  });

  it("report_empty_hours_returns_tree_encouragement", () => {
    expect(generateLearningReport(emptyWeek)).toBe(
      "这周似乎没有留下学习记录。没关系，种一棵树最好的时间是十年前，其次是现在。",
    );

    const withUnitsButNoTime = generateLearningReport({
      ...emptyWeek,
      totalUnits: 12,
      currentStreak: 3,
      longestStreak: 3,
    });
    expect(withUnitsButNoTime).toContain("种一棵树");
    expect(withUnitsButNoTime).not.toContain("状态拉满");

    const month = generateLearningReport({ ...emptyWeek, range: "month" });
    expect(month).toContain("这个月似乎没有留下学习记录");
    expect(month).toContain("种一棵树最好的时间是十年前，其次是现在。");
  });

  it("report_steady_week_stays_calm_and_relights_a_broken_streak", () => {
    const text = plain(
      generateLearningReport({
        range: "week",
        totalMinutes: 120,
        totalUnits: 2,
        subjects: [{ subject: "语文", minutes: 120 }],
        comparisons: [
          { subject: "语文", plannedMinutes: 120, actualMinutes: 120 },
        ],
        currentStreak: 0,
        longestStreak: 6,
      }),
    );

    expect(text).toContain("这周你共计投入了 2 小时，完成了 2 课的学习，稳步推进。");
    expect(text).not.toContain("状态拉满");
    expect(text).toContain("各科都跟上了计划，没有哪一科掉队超过三成。");
    expect(text).toContain("连击断了没关系，今天重新点燃它！");
    expect(text).toContain("你曾经连续打卡 6 天。");
  });

  it("report_high_volume_week_uses_peak_opening", () => {
    const text = generateLearningReport({
      range: "week",
      totalMinutes: 20 * 60,
      totalUnits: 10,
      subjects: [{ subject: "数学", minutes: 20 * 60 }],
      comparisons: [
        { subject: "数学", plannedMinutes: 20 * 60, actualMinutes: 20 * 60 },
      ],
      currentStreak: 7,
      longestStreak: 7,
    });

    expect(text).toContain("这周你共计投入了 20 小时，完成了 10 课的学习，状态拉满！");
  });

  it("report_gap_requires_shortfall_above_30_percent", () => {
    const base: ReportData = {
      range: "week",
      totalMinutes: 100,
      totalUnits: 1,
      subjects: [{ subject: "英语", minutes: 70 }],
      comparisons: [{ subject: "英语", plannedMinutes: 100, actualMinutes: 70 }],
      currentStreak: 1,
      longestStreak: 1,
    };

    expect(plain(generateLearningReport(base))).not.toContain("注意");

    const over = generateLearningReport({
      ...base,
      totalMinutes: 69,
      subjects: [{ subject: "英语", minutes: 69 }],
      comparisons: [{ subject: "英语", plannedMinutes: 100, actualMinutes: 69 }],
    });
    expect(plain(over)).toContain("但要注意，英语排了");
    expect(plain(over)).toContain("实际只完成了");
  });

  it("report_mentions_subject_that_beat_the_plan", () => {
    const text = plain(
      generateLearningReport({
        range: "month",
        totalMinutes: 180,
        totalUnits: 4,
        subjects: [{ subject: "物理", minutes: 180 }],
        comparisons: [
          { subject: "物理", plannedMinutes: 60, actualMinutes: 180 },
        ],
        currentStreak: 2,
        longestStreak: 2,
      }),
    );

    expect(text).toContain("这个月你共计投入了 3 小时，完成了 4 课的学习，稳步推进。");
    expect(text).toContain("物理依然是你最专注的阵地");
    expect(text).toContain("完成率最高的是 物理，达到 300%。");
    expect(text).toContain("物理超出了原计划，多投入了 2 小时。");
    expect(text).not.toContain("注意");
  });
});
