import { useMemo } from "react";
import { Link } from "react-router-dom";
import { TaskProgressRing } from "./ProgressRing";
import type { Task } from "../types";

export function TaskListView({ tasks }: { tasks: Task[] }) {
  const main = useMemo(() => tasks.filter((t) => t.type === "main"), [tasks]);
  const side = useMemo(() => tasks.filter((t) => t.type === "side"), [tasks]);

  return (
    <div data-testid="task-list-view" className="space-y-8">
      <TaskGroup title="主线" items={main} />
      <TaskGroup title="副本" items={side} />
    </div>
  );
}

function TaskGroup({ title, items }: { title: string; items: Task[] }) {
  return (
    <section>
      <h2 className="mb-3 font-display text-lg text-ink-muted">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">暂无{title}任务</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((t) => (
            <Link
              key={t.id}
              to={`/tasks/${t.id}`}
              className="flex items-center gap-4 rounded-xl border border-white/5 bg-surface-2/90 p-4 hover:border-accent/30"
            >
              {t.type === "main" && t.total_units ? (
                <TaskProgressRing
                  roundDone={t.actual_units_sum ?? 0}
                  roundTotal={t.total_units}
                  roundsDone={Math.max(0, t.current_round - 1)}
                  roundsTotal={t.total_rounds}
                  size={88}
                  unitName={t.unit_name}
                />
              ) : (
                <div
                  className="flex h-[88px] w-[88px] items-center justify-center rounded-full border border-white/10 text-xs text-ink-muted"
                  style={{ borderColor: t.color || undefined }}
                >
                  副本
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate font-medium">{t.title}</div>
                <div className="mt-1 text-xs text-ink-muted">
                  {t.subject ?? "无科目"}
                  {t.textbook ? ` · ${t.textbook}` : ""}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
