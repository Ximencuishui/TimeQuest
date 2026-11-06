import {
  formatStudyClock,
  type RemainingStudy,
  type TimedSession,
  resolveRemainingStudy,
} from "../lib/studyCountdown";

export function StudyRemaining({
  sessions,
  now,
  pending = false,
  study,
  clockClassName = "font-mono text-lg text-ink tabular-nums",
  labelClassName = "text-xs text-ink-muted",
}: {
  sessions?: TimedSession[];
  now?: Date;
  pending?: boolean;
  study?: RemainingStudy;
  clockClassName?: string;
  labelClassName?: string;
}) {
  if (pending) {
    return (
      <span data-testid="today-remaining" className={labelClassName}>
        今日剩余待学
      </span>
    );
  }

  const view = study ?? resolveRemainingStudy(sessions ?? [], now ?? new Date());
  if (view.kind === "done") {
    return (
      <span data-testid="today-remaining" className={labelClassName}>
        今日任务全部完成
      </span>
    );
  }

  const total = formatStudyClock(view.plannedMinutes * 60);
  return (
    <span data-testid="today-remaining" className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className={labelClassName}>今日剩余待学 {total}</span>
      {view.kind === "active" ? (
        <span className={labelClassName}>
          本场还剩{" "}
          <span data-testid="today-remaining-clock" className={clockClassName}>
            {formatStudyClock(view.seconds)}
          </span>
        </span>
      ) : null}
      {view.kind === "upcoming" ? (
        <span className={labelClassName}>
          距离{view.title}开始还有{" "}
          <span data-testid="today-remaining-clock" className={clockClassName}>
            {formatStudyClock(view.seconds)}
          </span>
        </span>
      ) : null}
    </span>
  );
}
