import { useEffect, useMemo, useRef } from "react";
import type { TaskSession } from "../types";
import {
  findScrollTargetSession,
  sessionTimePhase,
  startHourLabel,
  type SessionTimePhase,
} from "../lib/sessionTime";
import { SessionCard } from "./SessionCard";

type Props = {
  sessions: TaskSession[];
  now: Date;
  /** When false, skip time-phase styling and auto-scroll (other calendar days). */
  timeAware?: boolean;
  onComplete?: (session: TaskSession) => void;
  onReschedule?: (session: TaskSession) => void;
};

type TimelineRow = {
  session: TaskSession;
  phase: SessionTimePhase;
  tick: string | null;
};

export function TodayTimeline({
  sessions,
  now,
  timeAware = true,
  onComplete,
  onReschedule,
}: Props) {
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [sessions],
  );

  const rows: TimelineRow[] = useMemo(() => {
    const seenHours = new Set<string>();
    return sorted.map((session) => {
      const phase = timeAware
        ? sessionTimePhase(session.start_time, session.end_time, now)
        : "upcoming";
      const hour = startHourLabel(session.start_time);
      let tick: string | null = null;
      if (hour && !seenHours.has(hour)) {
        seenHours.add(hour);
        tick = hour;
      }
      return { session, phase, tick };
    });
  }, [sorted, now, timeAware]);

  const scrollTargetId = useMemo(() => {
    if (!timeAware) return null;
    return findScrollTargetSession(sorted, now)?.id ?? null;
  }, [sorted, now, timeAware]);

  const targetRef = useRef<HTMLDivElement | null>(null);
  const didScroll = useRef(false);

  useEffect(() => {
    didScroll.current = false;
  }, [scrollTargetId]);

  useEffect(() => {
    if (!timeAware || scrollTargetId === null || didScroll.current) return;
    const el = targetRef.current;
    if (!el) return;
    didScroll.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [timeAware, scrollTargetId, rows.length]);

  if (sorted.length === 0) return null;

  return (
    <ol className="relative m-0 list-none p-0" data-testid="today-timeline">
      {/* Vertical rail — sits in the tick column so cards stay full-width on narrow screens */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-2 left-[1.625rem] top-2 w-px bg-zinc-600/80 sm:left-[2.125rem]"
      />

      {rows.map(({ session, phase, tick }) => {
        const isFocus = scrollTargetId === session.id;
        const dotActive =
          phase === "active" && session.status === "planned";
        return (
          <li
            key={session.id}
            className="relative flex gap-2 sm:gap-3"
            data-testid={`timeline-row-${session.id}`}
            data-time-phase={phase}
          >
            <div className="flex w-11 shrink-0 flex-col items-center sm:w-14">
              {tick ? (
                <span
                  className="mb-1 text-xs leading-none text-zinc-500"
                  data-testid="timeline-tick"
                >
                  {tick}
                </span>
              ) : (
                <span className="mb-1 h-3" aria-hidden />
              )}
              <span
                data-testid={`timeline-dot-${session.id}`}
                className={
                  dotActive
                    ? "relative z-10 mt-3 h-2.5 w-2.5 rounded-full bg-orange-500 shadow-[0_0_0_4px_rgba(249,115,22,0.25)]"
                    : "relative z-10 mt-3 h-2.5 w-2.5 rounded-full bg-zinc-500"
                }
              />
            </div>

            <div
              ref={isFocus ? targetRef : undefined}
              className="min-w-0 flex-1 pb-3"
            >
              <SessionCard
                session={session}
                timePhase={timeAware ? phase : undefined}
                onComplete={onComplete ? () => onComplete(session) : undefined}
                onReschedule={
                  onReschedule ? () => onReschedule(session) : undefined
                }
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
