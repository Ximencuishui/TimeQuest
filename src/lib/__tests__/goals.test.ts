import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOALS_MIGRATED_KEY,
  LEGACY_EXAMS_KEY,
  migrateLegacyGoals,
  nextMockGoal,
  readLegacyGoals,
  resolvePrimaryGoal,
} from "../goals";
import { DEFAULT_EXAM_DATE, DEFAULT_GOAL_NAME } from "../constants";
import type { Goal } from "../../types";

const apiMock = vi.hoisted(() => ({
  listGoals: vi.fn(),
  upsertGoal: vi.fn(),
  removeGoal: vi.fn(),
  setPrimaryGoal: vi.fn(),
  listTracks: vi.fn(),
  getUserProfile: vi.fn(),
}));

vi.mock("../../api/tauri", () => ({ api: apiMock }));

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 1,
    trackId: null,
    name: "高考",
    date: "2027-06-07",
    kind: "exam",
    isPrimary: true,
    targetScore: null,
    createdAt: "2026-11-04 12:00:00",
    ...overrides,
  };
}

describe("目标解析", () => {
  it("goals_primary_goal_prefers_the_flagged_one", () => {
    const primary = resolvePrimaryGoal([
      goal({ id: 1, name: "一模", isPrimary: false }),
      goal({ id: 2, name: "高考", isPrimary: true }),
    ]);
    expect(primary?.id).toBe(2);
  });

  it("goals_primary_goal_falls_back_to_the_first_row", () => {
    const primary = resolvePrimaryGoal([goal({ id: 7, isPrimary: false })]);
    expect(primary?.id).toBe(7);
  });

  it("goals_primary_goal_is_undefined_without_any_goal", () => {
    expect(resolvePrimaryGoal([])).toBeUndefined();
  });
});

describe("模考倒计时", () => {
  it("mock_exam_picks_the_nearest_future_non_primary_exam", () => {
    const mock = nextMockGoal(
      [
        goal({ id: 1, isPrimary: true }),
        goal({ id: 2, name: "第二次模考", date: "2027-04-20", isPrimary: false }),
        goal({ id: 3, name: "第一次模考", date: "2027-03-10", isPrimary: false }),
      ],
      "2026-11-18",
    );

    expect(mock).not.toBeNull();
    expect(mock!.name).toBe("第一次模考");
    expect(mock!.daysLeft).toBe(112);
  });

  it("mock_exam_ignores_the_primary_exam", () => {
    expect(nextMockGoal([goal({ id: 1, isPrimary: true })], "2026-11-18")).toBeNull();
  });

  it("mock_exam_ignores_past_exams", () => {
    const mock = nextMockGoal(
      [
        goal({ id: 1, isPrimary: true }),
        goal({ id: 2, name: "第一次模考", date: "2026-10-20", isPrimary: false }),
      ],
      "2026-11-18",
    );
    expect(mock).toBeNull();
  });

  it("mock_exam_marks_today_as_is_today", () => {
    const mock = nextMockGoal(
      [
        goal({ id: 1, isPrimary: true }),
        goal({ id: 2, name: "一模", date: "2026-11-18", isPrimary: false }),
      ],
      "2026-11-18",
    );
    expect(mock!.isToday).toBe(true);
    expect(mock!.daysLeft).toBe(0);
  });

  it("mock_exam_returns_null_without_any_exam", () => {
    expect(nextMockGoal([], "2026-11-18")).toBeNull();
  });
});

describe("老目标一次性迁移", () => {
  beforeEach(() => {
    localStorage.clear();
    apiMock.listGoals.mockReset();
    apiMock.upsertGoal.mockReset();
    apiMock.removeGoal.mockReset();
    apiMock.setPrimaryGoal.mockReset();
    apiMock.listTracks.mockReset();
    apiMock.getUserProfile.mockReset();
    // 默认没有赛道、也没有档案：迁移只搬目标本身。
    apiMock.listTracks.mockResolvedValue([]);
    apiMock.getUserProfile.mockResolvedValue(null);
  });

  it("goals_read_legacy_goals_skips_broken_rows", () => {
    localStorage.setItem(
      LEGACY_EXAMS_KEY,
      JSON.stringify([
        { id: "gaokao", name: "高考", date: "2027-06-07", isPrimary: true },
        { id: "broken" },
        null,
      ]),
    );
    expect(readLegacyGoals()).toEqual([
      { id: "gaokao", name: "高考", date: "2027-06-07", isPrimary: true },
    ]);
  });

  it("goals_migration_moves_legacy_rows_and_clears_the_old_key", async () => {
    localStorage.setItem(
      LEGACY_EXAMS_KEY,
      JSON.stringify([
        { id: "gaokao", name: "高考", date: "2027-06-07", isPrimary: true },
        { id: "m1", name: "第一次模考", date: "2026-11-25", isPrimary: false },
      ]),
    );
    apiMock.listGoals.mockResolvedValue([]);
    apiMock.upsertGoal
      .mockResolvedValueOnce(goal({ id: 10, name: "高考", date: "2027-06-07" }))
      .mockResolvedValueOnce(
        goal({ id: 11, name: "第一次模考", date: "2026-11-25", isPrimary: false }),
      );

    const moved = await migrateLegacyGoals();

    expect(moved).toBe(true);
    expect(apiMock.upsertGoal).toHaveBeenCalledTimes(2);
    expect(apiMock.upsertGoal).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: "高考", date: "2027-06-07", isPrimary: true }),
    );
    expect(apiMock.setPrimaryGoal).not.toHaveBeenCalled();
    expect(localStorage.getItem(LEGACY_EXAMS_KEY)).toBeNull();
    expect(localStorage.getItem(GOALS_MIGRATED_KEY)).toBe("1");
  });

  it("goals_migration_drops_the_seeded_default_goal_before_moving", async () => {
    localStorage.setItem(
      LEGACY_EXAMS_KEY,
      JSON.stringify([
        { id: "gaokao", name: DEFAULT_GOAL_NAME, date: DEFAULT_EXAM_DATE, isPrimary: true },
      ]),
    );
    apiMock.listGoals.mockResolvedValue([
      goal({ id: 1, name: DEFAULT_GOAL_NAME, date: DEFAULT_EXAM_DATE }),
    ]);
    apiMock.removeGoal.mockResolvedValue(undefined);
    apiMock.upsertGoal.mockResolvedValue(
      goal({ id: 10, name: DEFAULT_GOAL_NAME, date: DEFAULT_EXAM_DATE }),
    );

    await migrateLegacyGoals();

    expect(apiMock.removeGoal).toHaveBeenCalledWith(1);
    expect(apiMock.upsertGoal).toHaveBeenCalledTimes(1);
  });

  it("goals_migration_sets_a_primary_when_the_legacy_data_has_none", async () => {
    localStorage.setItem(
      LEGACY_EXAMS_KEY,
      JSON.stringify([
        { id: "m1", name: "第一次模考", date: "2026-11-25", isPrimary: false },
      ]),
    );
    apiMock.listGoals.mockResolvedValue([]);
    apiMock.upsertGoal.mockResolvedValue(
      goal({ id: 11, name: "第一次模考", date: "2026-11-25", isPrimary: false }),
    );
    apiMock.listGoals
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([goal({ id: 11, isPrimary: false })]);

    await migrateLegacyGoals();

    expect(apiMock.setPrimaryGoal).toHaveBeenCalledWith(11);
  });

  it("goals_migration_only_runs_once", async () => {
    localStorage.setItem(GOALS_MIGRATED_KEY, "1");
    localStorage.setItem(
      LEGACY_EXAMS_KEY,
      JSON.stringify([
        { id: "gaokao", name: "高考", date: "2027-06-07", isPrimary: true },
      ]),
    );

    const moved = await migrateLegacyGoals();

    expect(moved).toBe(false);
    expect(apiMock.upsertGoal).not.toHaveBeenCalled();
  });

  it("goals_migration_marks_done_when_there_is_no_legacy_data", async () => {
    const moved = await migrateLegacyGoals();

    expect(moved).toBe(false);
    expect(apiMock.upsertGoal).not.toHaveBeenCalled();
    expect(localStorage.getItem(GOALS_MIGRATED_KEY)).toBe("1");
  });

  it("goals_migration_rolls_back_and_unmarks_when_writing_fails", async () => {
    localStorage.setItem(
      LEGACY_EXAMS_KEY,
      JSON.stringify([
        { id: "gaokao", name: "高考", date: "2027-06-07", isPrimary: true },
      ]),
    );
    apiMock.listGoals.mockResolvedValue([]);
    apiMock.upsertGoal.mockRejectedValueOnce(new Error("boom"));

    await expect(migrateLegacyGoals()).rejects.toThrow("boom");
    expect(localStorage.getItem(GOALS_MIGRATED_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_EXAMS_KEY)).not.toBeNull();
  });
});
