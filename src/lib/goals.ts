import { api } from "../api/tauri";
import { DEFAULT_EXAM_DATE, DEFAULT_GOAL_NAME } from "./constants";
import { daysBetween } from "./dateField";
import type { Goal } from "../types";

/** 4.0 之前倒计时目标存在 localStorage 里，现在改存数据库。 */
export const LEGACY_EXAMS_KEY = "timequest.exams";
/** 一次性迁移标记，防止重复搬。 */
export const GOALS_MIGRATED_KEY = "timequest.goals.migrated";

/** 老版本 localStorage 里的一条目标。 */
export type LegacyGoal = {
  id: string;
  name: string;
  date: string;
  isPrimary: boolean;
};

/** 读老版本存在 localStorage 里的目标；读不出来就当没有。 */
export function readLegacyGoals(): LegacyGoal[] {
  try {
    const raw = localStorage.getItem(LEGACY_EXAMS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LegacyGoal =>
        !!item &&
        typeof item === "object" &&
        typeof (item as LegacyGoal).name === "string" &&
        typeof (item as LegacyGoal).date === "string",
    );
  } catch {
    return [];
  }
}

/** 主目标：标了 isPrimary 的那条；没标就退回第一条。 */
export function resolvePrimaryGoal(goals: Goal[]): Goal | undefined {
  return goals.find((goal) => goal.isPrimary) ?? goals[0];
}

/** 下一个模考目标的倒计时信息。 */
export type MockGoal = {
  id: number;
  name: string;
  date: string;
  /** 距离今天还有几天；今天就是 0。 */
  daysLeft: number;
  isToday: boolean;
};

/**
 * 最近的一次模考。
 *
 * 模考 = 除主目标以外的其它目标；设置页里加一条「名称（如模考）+ 日期」即可。
 * 已经过去的目标不再倒计时，只取今天及以后的最近一个。
 */
export function nextMockGoal(goals: Goal[], today: string): MockGoal | null {
  const candidates = goals
    .filter((goal) => !goal.isPrimary && goal.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const target = candidates[0];
  if (!target) return null;

  const daysLeft = daysBetween(today, target.date) ?? 0;
  return {
    id: target.id,
    name: target.name,
    date: target.date,
    daysLeft,
    isToday: daysLeft === 0,
  };
}

/**
 * 把老版本 localStorage 里的目标一次性搬进数据库。
 *
 * 搬完删掉旧 key 并打标记，重复启动不会再搬。
 * 搬一半失败会把已写进去的行清掉，让下次启动从头再来。
 */
export async function migrateLegacyGoals(): Promise<boolean> {
  if (localStorage.getItem(GOALS_MIGRATED_KEY) === "1") return false;

  const legacy = readLegacyGoals();
  if (legacy.length === 0) {
    localStorage.setItem(GOALS_MIGRATED_KEY, "1");
    localStorage.removeItem(LEGACY_EXAMS_KEY);
    return false;
  }

  // 先打标记：主窗口和悬浮窗可能同时启动，标记让第二个窗口直接跳过。
  localStorage.setItem(GOALS_MIGRATED_KEY, "1");
  const created: number[] = [];
  try {
    const existing = await api.listGoals();
    // 启动时补的默认目标跟老数据撞车，先清掉，免得出现两条同名目标。
    for (const goal of existing) {
      if (goal.name === DEFAULT_GOAL_NAME && goal.date === DEFAULT_EXAM_DATE) {
        await api.removeGoal(goal.id);
      }
    }

    let hasPrimary = false;
    for (const item of legacy) {
      const goal = await api.upsertGoal({
        name: item.name,
        date: item.date,
        kind: "exam",
        isPrimary: item.isPrimary,
      });
      created.push(goal.id);
      if (goal.isPrimary) hasPrimary = true;
    }
    if (!hasPrimary) {
      const left = await api.listGoals();
      if (left[0]) await api.setPrimaryGoal(left[0].id);
    }

    localStorage.removeItem(LEGACY_EXAMS_KEY);
    return true;
  } catch (error) {
    for (const id of created) {
      await api.removeGoal(id).catch(() => undefined);
    }
    localStorage.removeItem(GOALS_MIGRATED_KEY);
    throw error;
  }
}