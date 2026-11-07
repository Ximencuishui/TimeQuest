import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { TaskProgressRing } from "../components/ProgressRing";
import { SessionCard } from "../components/SessionCard";
import { KnowledgePointList } from "../components/KnowledgePointDrawer";
import { useTask, useTaskKnowledgePoints, useTaskMutations, useTaskProgress } from "../hooks/useTasks";
import { useSessionsByTask } from "../hooks/useSessions";

export function TaskDetail() {
  const { id } = useParams();
  const taskId = Number(id);
  const idOrNull = Number.isFinite(taskId) ? taskId : null;
  const { data: task, isLoading } = useTask(idOrNull);
  const { data: progress } = useTaskProgress(idOrNull);
  const { data: sessions = [] } = useSessionsByTask(idOrNull);
  const { data: knowledgePoints } = useTaskKnowledgePoints(idOrNull);
  const points = Array.isArray(knowledgePoints) ? knowledgePoints : [];
  const { archive, advanceRound } = useTaskMutations();

  const byRound = useMemo(() => {
    const map = new Map<number, typeof sessions>();
    for (const s of sessions) {
      const list = map.get(s.round) ?? [];
      list.push(s);
      map.set(s.round, list);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [sessions]);

  // Ring / 本轮文案：唯一来源 task_progress.round_units（非 sessions reduce）。
  const roundDone = progress?.round_units ?? 0;

  if (isLoading || !task) {
    return <p className="text-ink-muted">加载中…</p>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/tasks" className="text-sm text-accent-soft hover:underline">
        ← 返回任务
      </Link>
      <div className="mt-4 flex flex-wrap items-start gap-6">
        {task.type === "main" && task.total_units ? (
          <TaskProgressRing
            roundDone={roundDone}
            roundTotal={task.total_units}
            roundsDone={Math.max(0, task.current_round - 1)}
            roundsTotal={task.total_rounds}
            unitName={task.unit_name}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl">{task.title}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {task.type === "main" ? "主线" : "副本"}
            {task.subject ? ` · ${task.subject}` : ""}
            {task.textbook ? ` · ${task.textbook}` : ""}
          </p>
          {task.type === "main" ? (
            <p className="mt-1 text-sm text-ink-muted">
              当前第 {task.current_round} / {task.total_rounds} 轮 · 本轮{" "}
              {roundDone}/{task.total_units} {task.unit_name}
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">
              完成次数{" "}
              {sessions.filter((s) => s.status === "done").length}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {task.type === "main" ? (
              <button
                type="button"
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5"
                onClick={() => advanceRound.mutate(task.id)}
              >
                推进到下一轮
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-ink-muted hover:bg-white/5"
              onClick={() =>
                archive.mutate({ id: task.id, archived: !task.archived })
              }
            >
              {task.archived ? "取消归档" : "归档"}
            </button>
          </div>
        </div>
      </div>

      {points.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-lg">考点</h2>
          <KnowledgePointList points={points} />
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-3 font-display text-lg">排期历史</h2>
        {byRound.length === 0 ? (
          <p className="text-sm text-ink-muted">暂无排期记录</p>
        ) : (
          <div className="space-y-6">
            {byRound.map(([round, list]) => {
              const done = list
                .filter((s) => s.status === "done")
                .reduce((a, s) => a + s.actual_units, 0);
              return (
                <div key={round}>
                  <h3 className="mb-2 text-sm text-ink-muted">
                    第 {round} 轮 · {done}
                    {task.total_units ? `/${task.total_units}` : ""}{" "}
                    {task.unit_name}
                  </h3>
                  <div className="space-y-2">
                    {list.map((s) => (
                      <SessionCard key={s.id} session={s} compact />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
