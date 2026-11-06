import type { TaskSession } from "../types";
import type { SessionTimePhase } from "../lib/sessionTime";

const STATUS_LABEL: Record<string, string> = {
  planned: "待完成",
  done: "已完成",
  missed: "错过",
  rescheduled: "已改期",
};

type Props = {
  session: TaskSession;
  onComplete?: () => void;
  onReschedule?: () => void;
  onFocus?: () => void;
  /** Whole-card click. Dashboard uses this to open the session on Today. */
  onClick?: () => void;
  compact?: boolean;
  /** Wall-clock phase on the Today timeline; omit elsewhere. */
  timePhase?: SessionTimePhase;
};

export function SessionCard({
  session,
  onComplete,
  onReschedule,
  onFocus,
  onClick,
  compact,
  timePhase,
}: Props) {
  const color = session.task_color || "#F97316";
  const canAct = session.status === "planned";
  // Dim finished / missed / rescheduled even if the clock window is still open.
  const isPast =
    timePhase === "past" ||
    (timePhase !== undefined && session.status !== "planned");
  const isActive = timePhase === "active" && session.status === "planned";

  const articleClass = [
    "rounded-xl border p-4",
    isActive
      ? "animate-pulse border-orange-500 bg-orange-500/10"
      : "border-white/5 bg-surface-2/90",
    isPast ? "opacity-50" : "",
    onClick
      ? "cursor-pointer transition duration-200 hover:-translate-y-0.5 hover:border-orange-500/40"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const titleClass = isPast ? "font-medium text-zinc-500" : "font-medium text-ink";
  const metaClass = isPast
    ? "mt-1 text-xs text-zinc-500"
    : "mt-1 text-xs text-ink-muted";

  const showActiveBadge = isActive;

  return (
    <article
      className={articleClass}
      style={
        isActive
          ? undefined
          : { borderLeftWidth: 3, borderLeftColor: color }
      }
      data-time-phase={timePhase}
      data-session-id={session.id}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={titleClass}>
            {session.task_title ?? `任务 #${session.task_id}`}
          </div>
          <div className={metaClass}>
            {session.start_time} – {session.end_time}
            {session.subject ? ` · ${session.subject}` : ""}
            {session.task_type === "main"
              ? ` · 第${session.round}轮 · 计划 ${session.planned_units}`
              : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canAct && onFocus ? (
            <button
              type="button"
              aria-label="开始专注"
              className="rounded-md px-2 py-1 text-xs text-accent-soft hover:bg-white/5"
              onClick={(event) => {
                event.stopPropagation();
                onFocus?.();
              }}
            >
              ▶ 开始专注
            </button>
          ) : null}
          {showActiveBadge ? (
            <span
              className="shrink-0 rounded-md bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-medium leading-none text-orange-300"
              data-testid="active-badge"
            >
              进行中
            </span>
          ) : (
            <span
              className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${
                session.status === "done"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : session.status === "rescheduled"
                    ? "bg-white/10 text-ink-muted"
                    : "bg-accent/15 text-accent-soft"
              }`}
            >
              {STATUS_LABEL[session.status] ?? session.status}
            </span>
          )}
        </div>
      </div>
      {!compact && canAct ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-soft"
            onClick={(event) => {
              event.stopPropagation();
              onComplete?.();
            }}
          >
            完成 ✓
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-ink-muted hover:bg-white/5"
            onClick={(event) => {
              event.stopPropagation();
              onReschedule?.();
            }}
          >
            改期 ↻
          </button>
        </div>
      ) : null}
      {session.status === "done" && session.actual_units > 0 ? (
        <p className={`mt-2 text-xs ${isPast ? "text-zinc-500" : "text-ink-muted"}`}>
          实际 {session.actual_units}
          {session.self_rating ? ` · 自评 ${session.self_rating}★` : ""}
          {session.xp_awarded ? ` · +${session.xp_awarded} XP` : ""}
        </p>
      ) : null}
    </article>
  );
}
