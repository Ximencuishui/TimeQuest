import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Task } from "../types";

/** Spec name for the current-round sum. `list_tasks` sends the same number as `actual_units_sum`. */
export type GridTask = Task & { current_round_units?: number };

export const MICRO_GRID_MAX = 50;

export type MicroGridLayout = {
  cells: number;
  perCell: number;
  lit: number;
  /** Units in the last cell. Equals `perCell` when the total divides evenly. */
  remainder: number;
};

export function doneUnits(task: GridTask): number {
  const raw = task.current_round_units ?? task.actual_units_sum ?? 0;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw;
}

/**
 * At most 50 cells. Above that, each cell stands for an integer number of units
 * so the card does not grow with `total_units`.
 */
export function microGridLayout(totalUnits: number, done: number): MicroGridLayout {
  const total = Math.max(0, Math.floor(totalUnits));
  const safeDone = Math.max(0, done);
  if (total === 0) return { cells: 0, perCell: 1, lit: 0, remainder: 0 };
  if (total <= MICRO_GRID_MAX) {
    return {
      cells: total,
      perCell: 1,
      lit: Math.min(total, Math.floor(safeDone)),
      remainder: 1,
    };
  }
  const perCell = Math.ceil(total / MICRO_GRID_MAX);
  const cells = Math.ceil(total / perCell);
  const remainder = total - (cells - 1) * perCell;
  const lit = Math.min(cells, Math.floor(safeDone / perCell));
  return { cells, perCell, lit, remainder };
}

function scaleLabel(layout: MicroGridLayout, unitName: string): string {
  if (layout.perCell === 1) return `每格 1 ${unitName}`;
  if (layout.remainder === layout.perCell) return `每格 ${layout.perCell} ${unitName}`;
  return `每格 ${layout.perCell} ${unitName}，末格 ${layout.remainder} ${unitName}`;
}

export function TaskGridView({
  tasks,
  onOpenKnowledge,
}: {
  tasks: GridTask[];
  onOpenKnowledge?: (task: GridTask) => void;
}) {
  const main = useMemo(() => tasks.filter((t) => t.type === "main"), [tasks]);
  const side = useMemo(() => tasks.filter((t) => t.type === "side"), [tasks]);

  return (
    <div data-testid="task-grid-view" className="space-y-8">
      <TaskGroup title="主线" items={main} empty="暂无主线任务" onOpenKnowledge={onOpenKnowledge} />
      <TaskGroup title="副本" items={side} empty="暂无副本任务" />
    </div>
  );
}

function TaskGroup({
  title,
  items,
  empty,
  onOpenKnowledge,
}: {
  title: string;
  items: GridTask[];
  empty: string;
  onOpenKnowledge?: (task: GridTask) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 font-display text-lg text-ink-muted">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((task) =>
            task.type === "side" ? (
              <SideCard key={task.id} task={task} />
            ) : (
              <MainCard key={task.id} task={task} onOpenKnowledge={onOpenKnowledge} />
            ),
          )}
        </div>
      )}
    </section>
  );
}

const cardClass =
  "block rounded-xl border border-white/5 bg-surface-2/90 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-lg";

function MainCard({
  task,
  onOpenKnowledge,
}: {
  task: GridTask;
  onOpenKnowledge?: (task: GridTask) => void;
}) {
  const total = task.total_units ?? 0;
  const done = doneUnits(task);
  const layout = total > 0 ? microGridLayout(total, done) : null;
  const columns = layout ? Math.min(10, layout.cells) : 0;
  const style = { borderLeftWidth: 3, borderLeftColor: task.color || "#F97316" };
  const body = (
    <>
      <CardHeader task={task} />
      {layout && layout.cells > 0 ? (
        <>
          <div
            data-testid="micro-grid"
            className="mt-3 grid gap-1"
            style={{ gridTemplateColumns: `repeat(${columns}, 0.75rem)` }}
          >
            {Array.from({ length: layout.cells }, (_, index) => {
              const lit = index < layout.lit;
              return (
                <span
                  key={index}
                  data-testid="micro-cell"
                  className={
                    lit
                      ? "h-3 w-3 rounded-sm bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.55)] transition duration-700"
                      : "h-3 w-3 rounded-sm bg-zinc-800 transition duration-700"
                  }
                />
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-zinc-500">
            已完成 {done}/{total} {task.unit_name} · {scaleLabel(layout, task.unit_name)}
          </p>
        </>
      ) : (
        <p className="mt-3 text-xs text-ink-muted">未设置总课数</p>
      )}
    </>
  );

  if (onOpenKnowledge) {
    return (
      <button
        type="button"
        className={`${cardClass} w-full text-left`}
        style={style}
        aria-label={`查看知识点 ${task.title}`}
        onClick={() => onOpenKnowledge(task)}
      >
        {body}
      </button>
    );
  }

  return (
    <Link to={`/tasks/${task.id}`} className={cardClass} style={style}>
      {body}
    </Link>
  );
}

function SideCard({ task }: { task: GridTask }) {
  const done = doneUnits(task);
  return (
    <Link
      to={`/tasks/${task.id}`}
      className={cardClass}
      style={{ borderLeftWidth: 3, borderLeftColor: task.color || "#F97316" }}
    >
      <CardHeader task={task} />
      <div className="mt-3 flex items-center gap-3">
        <span
          data-testid="side-task-icon"
          aria-label="副本"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-accent"
          style={{ color: task.color || undefined }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              d="M7.2 8.2c2.2-2.4 7.4-2.4 9.6 0 1.6 1.7 1.6 5.9 0 7.6-2.2 2.4-7.4 2.4-9.6 0-1.6-1.7-1.6-5.9 0-7.6z"
            />
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              d="M12 8.6c1.5 1.6 1.5 5.2 0 6.8-1.5-1.6-1.5-5.2 0-6.8z"
            />
          </svg>
        </span>
        <p className="text-sm">
          <span className="block text-[10px] text-zinc-500">累计完成</span>
          <span className="font-medium">
            {done} {task.unit_name}
          </span>
        </p>
      </div>
    </Link>
  );
}

function CardHeader({ task }: { task: GridTask }) {
  return (
    <div className="min-w-0">
      <h3 className="truncate font-medium">{task.title}</h3>
      <p className="mt-1 truncate text-xs text-ink-muted">
        {task.textbook || "未填课本"}
        {task.type === "main"
          ? ` · 第 ${task.current_round} / ${task.total_rounds} 轮`
          : ""}
      </p>
    </div>
  );
}
