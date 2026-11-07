import { describe, expect, it } from "vitest";
import {
  celebrationMessage,
  isCelebrationsEnabled,
  resolveCelebration,
} from "../celebration";

describe("celebration rules", () => {
  it("celebrations_default_on_until_setting_is_explicitly_off", () => {
    expect(isCelebrationsEnabled(null)).toBe(true);
    expect(isCelebrationsEnabled(undefined)).toBe(true);
    expect(isCelebrationsEnabled("")).toBe(true);
    expect(isCelebrationsEnabled("  ")).toBe(true);
    expect(isCelebrationsEnabled("1")).toBe(true);
    expect(isCelebrationsEnabled("0")).toBe(false);
    expect(isCelebrationsEnabled("false")).toBe(false);
    expect(isCelebrationsEnabled("FALSE")).toBe(false);
  });

  it("resolve_celebration_picks_task_streak_or_neither", () => {
    expect(
      resolveCelebration({
        isTaskFullyCompleted: true,
        streakMilestone: null,
        session: { task_title: "数学必修一" },
      }),
    ).toEqual({ type: "task_complete", taskTitle: "数学必修一" });

    expect(
      resolveCelebration({
        isTaskFullyCompleted: false,
        streakMilestone: 7,
        session: { task_title: "数学必修一" },
      }),
    ).toEqual({ type: "streak_milestone", streakDays: 7 });

    expect(
      resolveCelebration({
        isTaskFullyCompleted: false,
        streakMilestone: 14,
      }),
    ).toEqual({ type: "streak_milestone", streakDays: 14 });

    expect(
      resolveCelebration({
        isTaskFullyCompleted: false,
        streakMilestone: 30,
      }),
    ).toEqual({ type: "streak_milestone", streakDays: 30 });

    expect(
      resolveCelebration({
        isTaskFullyCompleted: true,
        streakMilestone: 7,
        session: { task_title: "数学必修一" },
      }),
    ).toEqual({ type: "task_complete", taskTitle: "数学必修一" });

    expect(
      resolveCelebration({
        isTaskFullyCompleted: false,
        currentStreak: 7,
        streakMilestone: null,
      } as { isTaskFullyCompleted: boolean; streakMilestone: null }),
    ).toBeNull();

    expect(
      resolveCelebration({
        streakMilestone: 8,
      }),
    ).toBeNull();

    expect(resolveCelebration({})).toBeNull();
  });

  it("celebration_copy_uses_the_book_title_and_the_seven_day_line", () => {
    expect(celebrationMessage("task_complete", { taskTitle: "数学必修一" })).toBe(
      "🎉 恭喜通关《数学必修一》！你的城堡又高了一层！",
    );
    expect(celebrationMessage("task_complete")).toBe(
      "🎉 恭喜通关！你的城堡又高了一层！",
    );
    expect(celebrationMessage("streak_milestone", { streakDays: 7 })).toBe(
      "🔥 连击 7 天达成！你已经击败了全国 90% 的考生！",
    );
    expect(celebrationMessage("streak_milestone", { streakDays: 14 })).toContain(
      "连击 14 天",
    );
    expect(celebrationMessage("streak_milestone", { streakDays: 30 })).toContain(
      "连击 30 天",
    );
  });
});
