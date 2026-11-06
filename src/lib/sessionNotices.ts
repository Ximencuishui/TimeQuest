import type { TaskSession } from "../types";
import { minutesOfDay, timeToMinutes } from "./sessionTime";

export const SESSION_NOTICES_KEY = "timequest.sessionNotices";
export const PREP_LEAD_MINUTES = 5;

export const PREP_NOTICE_BODY =
  "【准备】距离下一场学习还有 5 分钟，准备进入状态。";

export type NoticeKind = "prep" | "start";

export type PlannedNotice = {
  key: string;
  body: string;
};

type NoticeStore = {
  date: string;
  keys: string[];
};

export function noticeKey(sessionId: number, kind: NoticeKind): string {
  return `${sessionId}:${kind}`;
}

export function startNoticeBody(taskTitle: string | null | undefined): string {
  const name = taskTitle?.trim() ? taskTitle.trim() : "未命名任务";
  return `【开始】该学【${name}】了，冲！`;
}

export function loadSentNotices(today: string): Set<string> {
  try {
    const raw = localStorage.getItem(SESSION_NOTICES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as NoticeStore;
    if (!parsed || parsed.date !== today || !Array.isArray(parsed.keys)) {
      return new Set();
    }
    return new Set(parsed.keys.filter((key) => typeof key === "string"));
  } catch {
    return new Set();
  }
}

export function saveSentNotices(today: string, keys: Set<string>): void {
  const payload: NoticeStore = { date: today, keys: [...keys] };
  localStorage.setItem(SESSION_NOTICES_KEY, JSON.stringify(payload));
}

/**
 * Minute resolution, matching a once-a-minute clock.
 * Prep fires when start is exactly 5 minutes ahead. Start fires on the start minute.
 */
export function planSessionNotices(
  sessions: TaskSession[],
  now: Date,
  sent: ReadonlySet<string>,
): PlannedNotice[] {
  const nowMin = minutesOfDay(now);
  const due: PlannedNotice[] = [];
  for (const session of sessions) {
    if (session.status !== "planned") continue;
    const start = timeToMinutes(session.start_time);
    if (start === null) continue;
    const delta = start - nowMin;
    if (delta === PREP_LEAD_MINUTES) {
      const key = noticeKey(session.id, "prep");
      if (!sent.has(key)) due.push({ key, body: PREP_NOTICE_BODY });
    } else if (delta === 0) {
      const key = noticeKey(session.id, "start");
      if (!sent.has(key)) due.push({ key, body: startNoticeBody(session.task_title) });
    }
  }
  return due;
}
