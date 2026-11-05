import type { TaskSession } from "../types";

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
  compact?: boolean;
};

export function SessionCard({
  session,
  onComplete,
  onReschedule,
  compact,
}: Props) {
  const color = session.task_color || "#F97316";
  const canAct = session.status === "planned";

  return (
    <article
      className="rounded-xl border border-white/5 bg-surface-2/90 p-4"
      style={{ borderLeftWidth: 3, borderLeftColor: color }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-ink">
            {session.task_title ?? `任务 #${session.task_id}`}
          </div>
          <div className="mt-1 text-xs text-ink-muted">
            {session.start_time} – {session.end_time}
            {session.subject ? ` · ${session.subject}` : ""}
            {session.task_type === "main"
              ? ` · 第${session.round}轮 · 计划 ${session.planned_units}`
              : ""}
          </div>
        </div>
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
      </div>
      {!compact && canAct ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-soft"
            onClick={onComplete}
          >
            完成 ✓
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-ink-muted hover:bg-white/5"
            onClick={onReschedule}
          >
            改期 ↻
          </button>
        </div>
      ) : null}
      {session.status === "done" && session.actual_units > 0 ? (
        <p className="mt-2 text-xs text-ink-muted">
          实际 {session.actual_units}
          {session.self_rating ? ` · 自评 ${session.self_rating}★` : ""}
          {session.xp_awarded ? ` · +${session.xp_awarded} XP` : ""}
        </p>
      ) : null}
    </article>
  );
}
