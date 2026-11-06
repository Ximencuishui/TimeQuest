import { pad2 } from "./date";
import { timeToMinutes } from "./sessionTime";

export type TimedSession = {
  status: string;
  start_time: string;
  end_time: string;
  task_title?: string | null;
};

/** Sum of planned session lengths in minutes. Done and other statuses are skipped. */
export function calculateTodayRemainingMinutes(sessions: TimedSession[]): number {
  let total = 0;
  for (const session of sessions) {
    if (session.status !== "planned") continue;
    const start = timeToMinutes(session.start_time);
    const end = timeToMinutes(session.end_time);
    if (start == null || end == null || end <= start) continue;
    total += end - start;
  }
  return total;
}

export type RemainingStudy =
  | { kind: "done" }
  | {
      kind: "active" | "upcoming" | "overdue";
      title: string;
      plannedMinutes: number;
      seconds: number;
    };

function titleOf(session: TimedSession, fallback: string): string {
  const title = session.task_title?.trim();
  return title ? title : fallback;
}

/**
 * Planned minutes stay a fixed sum. The live number is the wall clock:
 * time left in the current planned session, or time until the next one starts.
 */
export function resolveRemainingStudy(sessions: TimedSession[], now: Date): RemainingStudy {
  const planned = sessions.filter((session) => session.status === "planned");
  if (planned.length === 0) return { kind: "done" };

  const plannedMinutes = calculateTodayRemainingMinutes(planned);
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
    };
  }

  const upcoming = windows.find((item) => nowSeconds < item.startSec);
  if (upcoming) {
    return {
      kind: "upcoming",
      title: titleOf(upcoming.session, "下一场"),
      plannedMinutes,
      seconds: upcoming.startSec - nowSeconds,
    };
  }

  return { kind: "overdue", title: "", plannedMinutes, seconds: 0 };
}

export function formatStudyClock(totalSeconds: number): string {
  const left = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = left % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}
