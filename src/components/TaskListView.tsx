import { useMemo } from "react";
import { Link } from "react-router-dom";
import { TaskProgressRing } from "./ProgressRing";
import type { Task } from "../types";

export function TaskListView({
  tasks,
  onOpenKnowledge,
  onUnarchive
}: {
  tasks: Task[];
  onOpenKnowledge?: (task: Task) => void;
  /** 归档任务上的「取消搁置」入口。 */
  onUnarchive?: (task: Task) => void;
}) {
  const active = useMemo(() => tasks.filter((t) => !t.archived), [tasks]);
  const archived = useMemo(() => tasks.filter((t) => t.archived), [tasks]);
  const main = useMemo(() => active.filter((t) => t.type === "main"), [active]);
  const side = useMemo(() => active.filter((t) => t.type === "side"), [active]);

  return (
    <div data-testid="task-list-view" className="space-y-8">
      <TaskGroup title="主线" items={main} onOpenKnowledge={onOpenKnowledge} />
      <TaskGroup title="副本" items={side} />
      {archived.length > 0 ? (
        <TaskGroup title="已归档" items={archived} onUnarchive={onUnarchive} />
      ) : null}
    </div>
  );
}

function TaskGroup({
  title,
  items,
  onOpenKnowledge,
  onUnarchive
}: {
  title: string;
  items: Task[];
  onOpenKnowledge?: (task: Task) => void;
  onUnarchive?: (task: Task) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 font-display text-lg text-ink-muted">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">暂无{title}任务</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((t) => {
            const cardClass =
              "flex items-center gap-4 rounded-xl border border-white/5 bg-surface-2/90 p-4 text-left hover:border-accent/30";
            // 归档任务只做查看和取消搁置，不进知识点抽屉。
            if (t.archived) {
              return (
                <div key={t.id} className={`${cardClass} flex-col items-stretch gap-3`}>
                  <div className="flex items-center gap-4">
                    <TaskBody task={t} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      to={`/tasks/${t.id}`}
                      className="text-xs text-accent-soft hover:underline"
                    >
                      查看详情
                    </Link>
                    {onUnarchive ? (
                      <button
                        type="button"
                        aria-label={`取消搁置 ${t.title}`}
                        className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-ink-muted hover:bg-white/5"
                        onClick={() => onUnarchive(t)}
                      >
                        取消搁置
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            }
            const body = <TaskBody task={t} />;
            if (t.type === "main" && onOpenKnowledge) {
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`${cardClass} w-full`}
                  aria-label={`查看知识点 ${t.title}`}
                  onClick={() => onOpenKnowledge(t)}
                >
                  {body}
                </button>
              );
            }
            return (
              <Link key={t.id} to={`/tasks/${t.id}`} className={cardClass}>
                {body}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TaskBody({ task }: { task: Task }) {
  return (
    <>
      {task.type === "main" && task.total_units ? (
        <TaskProgressRing
          roundDone={task.actual_units_sum ?? 0}
          roundTotal={task.total_units}
          roundsDone={Math.max(0, task.current_round - 1)}
          roundsTotal={task.total_rounds}
          size={88}
          unitName={task.unit_name}
        />
      ) : (
        <div
          className="flex h-[88px] w-[88px] items-center justify-center rounded-full border border-white/10 text-xs text-ink-muted"
          style={{ borderColor: task.color || undefined }}
        >
          副本
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate font-medium">{task.title}</div>
        <div className="mt-1 text-xs text-ink-muted">
          {task.subject ?? "无科目"}
          {task.textbook ? ` · ${task.textbook}` : ""}
        </div>
      </div>
    </>
  );
}
