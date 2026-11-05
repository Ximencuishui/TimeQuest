/** Pure XP / level / streak helpers — unit-tested. */

export type TaskKind = "main" | "side";

export const BASE_UNIT_XP: Record<TaskKind, number> = {
  main: 12,
  side: 10,
};

export const RESCHEDULE_RECOVERY_BONUS = 5;

/** Quality multiplier from 1–5 self rating. */
export function qualityMultiplier(rating: number | null | undefined): number {
  if (rating == null) return 1;
  if (rating >= 4) return 1.2;
  if (rating === 3) return 1.0;
  if (rating >= 1) return 0.9;
  return 1;
}

/** Streak day ladder: 3→1.1, 7→1.2, 14→1.3, cap 1.5 */
export function streakMultiplier(streakDays: number): number {
  if (streakDays >= 30) return 1.5;
  if (streakDays >= 14) return 1.3;
  if (streakDays >= 7) return 1.2;
  if (streakDays >= 3) return 1.1;
  return 1;
}

export function calcSessionXp(opts: {
  actualUnits: number;
  taskType: TaskKind;
  selfRating?: number | null;
  streakDays: number;
}): number {
  if (opts.actualUnits <= 0) return 0;
  const raw =
    opts.actualUnits *
    BASE_UNIT_XP[opts.taskType] *
    qualityMultiplier(opts.selfRating) *
    streakMultiplier(opts.streakDays);
  return Math.round(raw);
}

/** XP required to go from `level` to level+1. */
export function xpRequiredForLevel(level: number): number {
  if (level < 1) return 100;
  return Math.round(100 * Math.pow(level, 1.5));
}

/** Total XP needed to *reach* a given level (level 1 = 0). */
export function totalXpToReachLevel(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) {
    sum += xpRequiredForLevel(l);
  }
  return sum;
}

export function levelFromTotalXp(totalXp: number): {
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
} {
  let level = 1;
  let remaining = Math.max(0, totalXp);
  while (true) {
    const need = xpRequiredForLevel(level);
    if (remaining < need) {
      return { level, xpIntoLevel: remaining, xpForNext: need };
    }
    remaining -= need;
    level += 1;
    if (level > 999) {
      return { level: 999, xpIntoLevel: remaining, xpForNext: need };
    }
  }
}

/**
 * Update streak given previous state and a done date (YYYY-MM-DD, local).
 * Returns new current/longest/last_done_date.
 */
export function updateStreak(
  prev: {
    currentStreak: number;
    longestStreak: number;
    lastDoneDate: string | null;
  },
  doneDate: string,
): {
  currentStreak: number;
  longestStreak: number;
  lastDoneDate: string;
} {
  const last = prev.lastDoneDate;
  if (last === doneDate) {
    return {
      currentStreak: Math.max(1, prev.currentStreak),
      longestStreak: Math.max(prev.longestStreak, Math.max(1, prev.currentStreak)),
      lastDoneDate: doneDate,
    };
  }

  let next = 1;
  if (last) {
    const lastMs = Date.parse(`${last}T00:00:00`);
    const doneMs = Date.parse(`${doneDate}T00:00:00`);
    const dayDiff = Math.round((doneMs - lastMs) / 86_400_000);
    if (dayDiff === 1) {
      next = prev.currentStreak + 1;
    } else if (dayDiff < 0) {
      // older backfill — don't break current streak if last is newer
      return {
        currentStreak: prev.currentStreak,
        longestStreak: prev.longestStreak,
        lastDoneDate: last,
      };
    }
  }

  return {
    currentStreak: next,
    longestStreak: Math.max(prev.longestStreak, next),
    lastDoneDate: doneDate,
  };
}

export const ACHIEVEMENT_IDS = {
  FIRST_ROUND: "first_round",
  COMEBACK: "comeback",
  BALANCED: "balanced",
  STREAK_5: "streak_5",
} as const;
