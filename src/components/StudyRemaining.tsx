import { MAX_DAILY_STUDY_MINUTES } from "../lib/constants";
import { GlossaryHint } from "./GlossaryHint";
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
  limitMinutes = MAX_DAILY_STUDY_MINUTES,
  clockClassName = "font-mono text-lg text-ink tabular-nums",
  labelClassName = "text-xs text-ink-muted",
}: {
  sessions?: TimedSession[];
  now?: Date;
  pending?: boolean;
  study?: RemainingStudy;
  /** 每日学习上限（分钟），「今日剩余待学」按它封顶。 */
  limitMinutes?: number;
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

  const view = study ?? resolveRemainingStudy(sessions ?? [], now ?? new Date(), limitMinutes);
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
      <span className="inline-flex items-center gap-1.5">
        <span className={labelClassName}>今日剩余待学 {total}</span>
        <GlossaryHint id="remaining" />
      </span>
      {view.mergedSessions > 0 ? (
        <span className={labelClassName}>
          （{view.mergedSessions} 场时间重叠，已按实际时段合并）
        </span>
      ) : null}
      {view.capped ? (
        <span className={labelClassName}>
          （已按每日 {MAX_DAILY_STUDY_MINUTES / 60} 小时上限计）
        </span>
      ) : null}
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
