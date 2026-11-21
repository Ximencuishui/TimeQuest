import { useMemo } from "react";
import { parseLocalDate } from "../lib/calendar";
import {
  buildGanttSegments,
  computeGanttBounds,
  ganttRatio,
} from "../lib/planViews";
import type { Task, TaskSession } from "../types";
import { EmptyPlan } from "./PlanCalendarView";

type Props = {
  tasks: Task[];
  sessions: TaskSession[];
  today: string;
};

const LABEL_WIDTH = "w-40";

/**
 * 总计划的甘特视图：每个任务一条时间轴，看计划铺到什么时候、哪段还没排。
 *
 * 横轴是日期，条是排期：实心 = 已完成，浅色 = 待完成，灰红 = 已错过。
 */
export function PlanGanttView({ tasks, sessions, today }: Props) {
  const bounds = useMemo(
    () => computeGanttBounds(sessions, today),
    [sessions, today],
  );

  const sessionsByTask = useMemo(() => {
    const map = new Map<number, TaskSession[]>();
    for (const session of sessions) {
      const list = map.get(session.task_id) ?? [];
      list.push(session);
      map.set(session.task_id, list);
    }
    return map;
  }, [sessions]);

  const ticks = useMemo(() => {
    const result: { ratio: number; label: string }[] = [];
    const start = parseLocalDate(bounds.start);
    if (Number.isNaN(start.getTime())) return result;
    for (let offset = 0; offset < bounds.totalDays; offset += 7) {
      const date = new Date(start);
      date.setDate(date.getDate() + offset);
      result.push({
        ratio: bounds.totalDays <= 1 ? 0 : offset / (bounds.totalDays - 1),
        label: `${date.getMonth() + 1}/${date.getDate()}`,
      });
    }
    return result;
  }, [bounds]);

  if (tasks.length === 0) {
    return <EmptyPlan text="当前筛选下没有任务，换个标签或先建一条主线。" />;
  }

  const todayRatio = ganttRatio(today, bounds);

  return (
    <section data-testid="plan-gantt-view" aria-label="总计划甘特图">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-accent" />已完成
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm border border-accent/50 bg-accent/15" />
          待完成
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-rose-500/50" />已错过
        </span>
        <span className="ml-auto">
          {bounds.start} → {bounds.end}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/5 bg-surface-2/50">
        <div className="min-w-[40rem]">
          <div className="flex border-b border-white/5">
            <div className={`${LABEL_WIDTH} shrink-0 px-3 py-1.5 text-[11px] text-ink-muted`}>
              任务
            </div>
            <div className="relative h-7 flex-1">
              {ticks.map((tick) => (
                <span
                  key={tick.label}
                  className="absolute top-1 -translate-x-1/2 text-[10px] text-ink-muted/70"
                  style={{ left: `${tick.ratio * 100}%` }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
          </div>

          {tasks.map((task) => {
            const taskSessions = sessionsByTask.get(task.id) ?? [];
            const segments = buildGanttSegments(taskSessions);
            const total = task.total_units ?? 0;
            const done = task.actual_units_sum ?? 0;
            const ratio = total > 0 ? Math.min(1, done / total) : 0;
            return (
              <div
                key={task.id}
                data-testid={`plan-gantt-row-${task.id}`}
                className="flex border-b border-white/5 last:border-b-0"
              >
                <div className={`${LABEL_WIDTH} shrink-0 px-3 py-2`}>
                  <p className="truncate text-xs text-ink" title={task.title}>
                    {task.title}
                  </p>
                  {total > 0 ? (
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${ratio * 100}%` }}
                        />
                      </span>
                      <span className="shrink-0 text-[10px] text-ink-muted">
                        {done}/{total}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="relative h-10 flex-1">
                  <div
                    className="absolute inset-y-0 w-px bg-accent/40"
                    style={{ left: `${todayRatio * 100}%` }}
                    aria-hidden
                  />
                  {segments.length === 0 ? (
                    <span className="absolute left-2 top-2.5 text-[10px] text-ink-muted/60">
                      还没排期
                    </span>
                  ) : null}
                  {segments.map((segment) => {
                    const left = ganttRatio(segment.start, bounds);
                    const right = ganttRatio(segment.end, bounds);
                    const width = Math.max(0.02, right - left);
                    return (
                      <span
                        key={`${segment.start}-${segment.end}`}
                        data-testid="plan-gantt-bar"
                        title={`${segment.start} → ${segment.end}｜计划 ${segment.plannedUnits}，完成 ${segment.doneUnits}`}
                        className={[
                          "absolute top-2.5 h-4 rounded-sm",
                          segment.status === "done"
                            ? "bg-accent"
                            : segment.status === "missed"
                              ? "bg-rose-500/50"
                              : "border border-accent/50 bg-accent/15",
                        ].join(" ")}
                        style={{
                          left: `${left * 100}%`,
                          width: `${width * 100}%`,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
