import { api } from "../api/tauri";
import { DEFAULT_EXAM_DATE, DEFAULT_GOAL_NAME } from "./constants";
import { daysBetween } from "./dateField";
import type { Goal, Track } from "../types";

/** 4.0 之前倒计时目标存在 localStorage 里，现在改存数据库。 */
export const LEGACY_EXAMS_KEY = "timequest.exams";
/** 一次性迁移标记，防止重复搬。只有搬完才写。 */
export const GOALS_MIGRATED_KEY = "timequest.goals.migrated";
/**
 * 搬迁中的快照。
 *
 * 标记只在搬完之后才写：先打标记的话，搬一半崩溃就把老目标永久丢在
 * localStorage 里（标记说「搬过了」，下次启动直接跳过）。
 * 快照记下当时要搬的每一行，崩溃后重启用同一份快照重搬，
 * 既不会读到被改过的旧 key，也不会搬出重复的行。
 */
export const GOALS_MIGRATING_KEY = "timequest.goals.migrating";

/** 搬迁锁的时长。超过它就当成上次崩溃留下的残留，可以重搬。 */
const MIGRATION_LOCK_MS = 30_000;

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

/** 搬迁中的快照：待搬的行 + 上次开始的时间。 */
type MigrationSnapshot = {
  items: LegacyGoal[];
  startedAt: number;
};

/** 读搬迁快照；读不出来就当没有。 */
export function readMigrationSnapshot(): MigrationSnapshot | null {
  try {
    const raw = localStorage.getItem(GOALS_MIGRATING_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const items = (parsed as MigrationSnapshot).items;
    const startedAt = (parsed as MigrationSnapshot).startedAt;
    if (!Array.isArray(items) || typeof startedAt !== "number") return null;
    return { items: items as LegacyGoal[], startedAt };
  } catch {
    return null;
  }
}

/**
 * 把老版本 localStorage 里的目标一次性搬进数据库。
 *
 * 顺序很要紧：**搬完才打标记**。
 * 先打标记的话，搬一半崩溃（进程被杀、机器断电）就会把老目标永久丢下——
 * 标记说「搬过了」，下次启动直接跳过，老数据还躺在 localStorage 里没人管。
 *
 * 现在改成：
 * - 搬之前先把要搬的行记进快照（崩溃后重启用同一份快照）；
 * - 搬完之后才写 `GOALS_MIGRATED_KEY`；
 * - 重复启动靠快照里的时间戳加锁，主窗口和悬浮窗不会同时搬。
 *
 * 搬一半失败会把已写进去的行清掉，让下次启动从头再来。
 */
export async function migrateLegacyGoals(): Promise<boolean> {
  if (localStorage.getItem(GOALS_MIGRATED_KEY) === "1") return false;

  const now = Date.now();
  const snapshot = readMigrationSnapshot();
  // 另一个窗口正在搬：让它搬，本窗口跳过。
  if (snapshot && now - snapshot.startedAt < MIGRATION_LOCK_MS) return false;

  const items = snapshot?.items ?? readLegacyGoals();
  if (items.length === 0) {
    localStorage.setItem(GOALS_MIGRATED_KEY, "1");
    localStorage.removeItem(LEGACY_EXAMS_KEY);
    return false;
  }

  // 先把快照记下来：搬一半崩溃时，下次启动还能按同一份快照重搬。
  localStorage.setItem(
    GOALS_MIGRATING_KEY,
    JSON.stringify({ items, startedAt: now } satisfies MigrationSnapshot),
  );

  const created: number[] = [];
  try {
    const existing = await api.listGoals();
    // 重跑幂等：快照里的同名同日期目标先删掉重建，
    // 不然崩溃后重搬会攒出两条一样的目标。
    for (const goal of existing) {
      const inSnapshot = items.some(
        (item) => item.name === goal.name && item.date === goal.date,
      );
      // 启动时补的默认目标跟老数据撞车，也先清掉，免得出现两条同名目标。
      const isSeededDefault =
        goal.name === DEFAULT_GOAL_NAME && goal.date === DEFAULT_EXAM_DATE;
      if (inSnapshot || isSeededDefault) {
        await api.removeGoal(goal.id);
      }
    }

    // 老版本的 localStorage 目标里既没有总分目标也没有赛道。
    // 总分目标从档案的 `total_target` 搬过来，赛道挂到当前主赛道——
    // 免得搬完成绩页的目标线凭空消失，目标也游离在赛道之外。
    let totalTarget: number | null = null;
    try {
      const profile = await api.getUserProfile();
      totalTarget = profile.total_target ?? null;
    } catch {
      totalTarget = null;
    }
    let tracks: Track[] = [];
    try {
      tracks = (await api.listTracks()) ?? [];
    } catch {
      tracks = [];
    }
    const trackId =
      tracks.find((track) => track.isPrimary)?.id ?? tracks[0]?.id ?? null;

    let hasPrimary = false;
    for (const item of items) {
      const goal = await api.upsertGoal({
        name: item.name,
        date: item.date,
        kind: "exam",
        isPrimary: item.isPrimary,
        trackId,
        targetScore: item.isPrimary ? totalTarget : undefined,
      });
      created.push(goal.id);
      if (goal.isPrimary) hasPrimary = true;
    }
    if (!hasPrimary) {
      const left = await api.listGoals();
      if (left[0]) await api.setPrimaryGoal(left[0].id);
    }

    // 搬完了才写标记：这一步之前崩溃，下次启动会按快照重搬。
    localStorage.removeItem(GOALS_MIGRATING_KEY);
    localStorage.setItem(GOALS_MIGRATED_KEY, "1");
    localStorage.removeItem(LEGACY_EXAMS_KEY);
    return true;
  } catch (error) {
    for (const id of created) {
      await api.removeGoal(id).catch(() => undefined);
    }
    // 快照留着：下次启动按同一份快照重搬，不会漏也不会重。
    throw error;
  }
}