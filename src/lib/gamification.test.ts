import { describe, expect, it } from "vitest";
import {
  calcSessionXp,
  levelFromTotalXp,
  qualityMultiplier,
  streakMultiplier,
  updateStreak,
  xpRequiredForLevel,
} from "./gamification";

describe("qualityMultiplier", () => {
  it("applies small bands", () => {
    expect(qualityMultiplier(5)).toBe(1.2);
    expect(qualityMultiplier(4)).toBe(1.2);
    expect(qualityMultiplier(3)).toBe(1);
    expect(qualityMultiplier(2)).toBe(0.9);
    expect(qualityMultiplier(null)).toBe(1);
  });
});

describe("streakMultiplier", () => {
  it("ladders correctly", () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(3)).toBe(1.1);
    expect(streakMultiplier(7)).toBe(1.2);
    expect(streakMultiplier(14)).toBe(1.3);
    expect(streakMultiplier(40)).toBe(1.5);
  });
});

describe("calcSessionXp", () => {
  it("returns 0 when actual_units is 0", () => {
    expect(
      calcSessionXp({
        actualUnits: 0,
        taskType: "main",
        selfRating: 5,
        streakDays: 10,
      }),
    ).toBe(0);
  });

  it("rewards main slightly above side", () => {
    const main = calcSessionXp({
      actualUnits: 2,
      taskType: "main",
      selfRating: 3,
      streakDays: 0,
    });
    const side = calcSessionXp({
      actualUnits: 2,
      taskType: "side",
      selfRating: 3,
      streakDays: 0,
    });
    expect(main).toBe(24);
    expect(side).toBe(20);
    expect(main).toBeGreaterThan(side);
  });
});

describe("level curve", () => {
  it("grows with level^1.5", () => {
    expect(xpRequiredForLevel(1)).toBe(100);
    expect(xpRequiredForLevel(4)).toBe(800);
  });

  it("maps total xp to level", () => {
    expect(levelFromTotalXp(0).level).toBe(1);
    expect(levelFromTotalXp(100).level).toBe(2);
  });
});

describe("updateStreak", () => {
  it("starts at 1", () => {
    expect(
      updateStreak(
        { currentStreak: 0, longestStreak: 0, lastDoneDate: null },
        "2026-11-04",
      ),
    ).toEqual({
      currentStreak: 1,
      longestStreak: 1,
      lastDoneDate: "2026-11-04",
    });
  });

  it("increments consecutive days", () => {
    expect(
      updateStreak(
        {
          currentStreak: 2,
          longestStreak: 5,
          lastDoneDate: "2026-11-03",
        },
        "2026-11-04",
      ),
    ).toEqual({
      currentStreak: 3,
      longestStreak: 5,
      lastDoneDate: "2026-11-04",
    });
  });

  it("resets on gap without clearing longest", () => {
    expect(
      updateStreak(
        {
          currentStreak: 7,
          longestStreak: 10,
          lastDoneDate: "2026-11-01",
        },
        "2026-11-04",
      ),
    ).toEqual({
      currentStreak: 1,
      longestStreak: 10,
      lastDoneDate: "2026-11-04",
    });
  });

  it("same day is idempotent", () => {
    expect(
      updateStreak(
        {
          currentStreak: 3,
          longestStreak: 3,
          lastDoneDate: "2026-11-04",
        },
        "2026-11-04",
      ).currentStreak,
    ).toBe(3);
  });
});
