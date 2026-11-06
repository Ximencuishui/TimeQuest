import type { TaskSession } from "../types";

export type SessionTimePhase = "past" | "active" | "upcoming";

/** Parse "HH:MM" / "H:MM" to minutes since midnight; invalid → null. */
export function timeToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

export function minutesOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Compare wall-clock minutes with session start/end (same calendar day).
 * - past: now > end
 * - active: start <= now <= end
 * - upcoming: now < start
 */
export function sessionTimePhase(
  startTime: string,
  endTime: string,
  now: Date,
): SessionTimePhase {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null) return "upcoming";
  const nowMin = minutesOfDay(now);
  if (nowMin > end) return "past";
  if (nowMin < start) return "upcoming";
  return "active";
}

/**
 * First in-progress planned session, else earliest upcoming planned;
 * null if empty / all past / no remaining planned work.
 */
export function findScrollTargetSession(
  sessions: TaskSession[],
  now: Date,
): TaskSession | null {
  if (sessions.length === 0) return null;
  const sorted = [...sessions].sort((a, b) =>
    a.start_time.localeCompare(b.start_time),
  );
  const planned = sorted.filter((s) => s.status === "planned");
  if (planned.length === 0) return null;
  const active = planned.find(
    (s) => sessionTimePhase(s.start_time, s.end_time, now) === "active",
  );
  if (active) return active;
  const upcoming = planned.find(
    (s) => sessionTimePhase(s.start_time, s.end_time, now) === "upcoming",
  );
  return upcoming ?? null;
}

/** Unique start-hour labels ("08:00") in chronological order. */
export function timelineHourTicks(sessions: TaskSession[]): string[] {
  const hours = new Set<number>();
  for (const s of sessions) {
    const mins = timeToMinutes(s.start_time);
    if (mins === null) continue;
    hours.add(Math.floor(mins / 60));
  }
  return [...hours]
    .sort((a, b) => a - b)
    .map((h) => `${String(h).padStart(2, "0")}:00`);
}

export function startHourLabel(startTime: string): string | null {
  const mins = timeToMinutes(startTime);
  if (mins === null) return null;
  const h = Math.floor(mins / 60);
  return `${String(h).padStart(2, "0")}:00`;
}
