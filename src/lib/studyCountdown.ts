import { MAX_DAILY_STUDY_MINUTES } from "./constants";
import { pad2 } from "./date";
import { timeToMinutes } from "./sessionTime";

export type TimedSession = {
  status: string;
  start_time: string;
  end_time: string;
  task_title?: string | null;
};

/** 一个待学时间窗（分钟，自当天 00:00 起算）。 */
export type StudyWindow = { start: number; end: number };

/** planned 排期中合法的时间窗（跳过已完成的与写坏时间的）。 */
function plannedWindowList(sessions: TimedSession[]): StudyWindow[] {
  const windows: StudyWindow[] = [];
  for (const session of sessions) {
    if (session.status !== "planned") continue;
    const start = timeToMinutes(session.start_time);
    const end = timeToMinutes(session.end_time);
    if (start == null || end == null || end <= start) continue;
    windows.push({ start, end });
  }
  return windows;
}

/**
 * 把 planned 排期压成互不重叠的时间窗。
 *
 * 防呆：同一天同一时段排了多场课（教材导入的老毛病）时，人只能同时学一门，
 * 所以重叠部分只算一次，而不是把每场课的长度加在一起。
 */
export function mergePlannedWindows(sessions: TimedSession[]): StudyWindow[] {
  const sorted = plannedWindowList(sessions).sort((a, b) => a.start - b.start);
  const merged: StudyWindow[] = [];
  for (const win of sorted) {
    const last = merged[merged.length - 1];
    if (last && win.start <= last.end) {
      last.end = Math.max(last.end, win.end);
      continue;
    }
    merged.push({ ...win });
  }
  return merged;
}

/** 今日待学计划的汇总，供「今日剩余待学」展示与解释用。 */
export type TodayPlan = {
  /** 去重合并后的待学分钟数（未封顶） */
  mergedMinutes: number;
  /** 实际展示的分钟数（封顶后） */
  minutes: number;
  /** 被合并进别的时段的排期场次数 */
  mergedSessions: number;
  /** 是否触到每日上限 */
  capped: boolean;
};

/** 汇总今日待学：先合并重叠时段，再按每日上限封顶。 */
export function summarizeTodayPlan(
  sessions: TimedSession[],
  limitMinutes = MAX_DAILY_STUDY_MINUTES,
): TodayPlan {
  const limit = Math.min(
    Math.max(Math.round(limitMinutes), 1),
    MAX_DAILY_STUDY_MINUTES,
  );
  const windows = mergePlannedWindows(sessions);
  const mergedMinutes = windows.reduce((sum, win) => sum + (win.end - win.start), 0);
  const validCount = plannedWindowList(sessions).length;
  return {
    mergedMinutes,
    minutes: Math.min(mergedMinutes, limit),
    mergedSessions: Math.max(0, validCount - windows.length),
    capped: mergedMinutes > limit,
  };
}

/**
 * 今日待学分钟数：重叠时段只算一次，并且不超过每日上限。
 *
 * done 与其它状态不计入。
 */
export function calculateTodayRemainingMinutes(
  sessions: TimedSession[],
  limitMinutes = MAX_DAILY_STUDY_MINUTES,
): number {
  return summarizeTodayPlan(sessions, limitMinutes).minutes;
}

export type RemainingStudy =
  | { kind: "done" }
  | {
      kind: "active" | "upcoming" | "overdue";
      title: string;
      plannedMinutes: number;
      seconds: number;
      /** 有几场排期因为时间重叠被合并了 */
      mergedSessions: number;
      /** 待学总量是否触到每日上限 */
      capped: boolean;
    };

function titleOf(session: TimedSession, fallback: string): string {
  const title = session.task_title?.trim();
  return title ? title : fallback;
}

/**
 * Planned minutes stay a fixed sum. The live number is the wall clock:
 * time left in the current planned session, or time until the next one starts.
 */
export function resolveRemainingStudy(
  sessions: TimedSession[],
  now: Date,
  limitMinutes = MAX_DAILY_STUDY_MINUTES,
): RemainingStudy {
  const planned = sessions.filter((session) => session.status === "planned");
  if (planned.length === 0) return { kind: "done" };

  const plan = summarizeTodayPlan(sessions, limitMinutes);
  const plannedMinutes = plan.minutes;
  const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const windows = planned
    .map((session) => {
      const start = timeToMinutes(session.start_time);
      const end = timeToMinutes(session.end_time);
      if (start == null || end == null || end <= start) return null;
      return { session, startSec: start * 60, endSec: end * 60 };
    })
    .filter((item): item is { session: TimedSession; startSec: number; endSec: number } => item != null)
    .sort((a, b) => a.startSec - b.startSec);

  const active = windows.find((item) => nowSeconds >= item.startSec && nowSeconds < item.endSec);
  if (active) {
    return {
      kind: "active",
      title: titleOf(active.session, "这场"),
      plannedMinutes,
      seconds: active.endSec - nowSeconds,
      mergedSessions: plan.mergedSessions,
      capped: plan.capped,
    };
  }

  const upcoming = windows.find((item) => nowSeconds < item.startSec);
  if (upcoming) {
    return {
      kind: "upcoming",
      title: titleOf(upcoming.session, "下一场"),
      plannedMinutes,
      seconds: upcoming.startSec - nowSeconds,
      mergedSessions: plan.mergedSessions,
      capped: plan.capped,
    };
  }

  return {
    kind: "overdue",
    title: "",
    plannedMinutes,
    seconds: 0,
    mergedSessions: plan.mergedSessions,
    capped: plan.capped,
  };
}

export function formatStudyClock(totalSeconds: number): string {
  const left = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = left % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}
