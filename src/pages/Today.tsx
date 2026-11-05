import { useMemo, useState } from "react";
import { CompleteDialog } from "../components/CompleteDialog";
import { RescheduleDialog } from "../components/RescheduleDialog";
import { Modal } from "../components/Modal";
import { SessionCard } from "../components/SessionCard";
import { useTasks } from "../hooks/useTasks";
import { useSessionMutations, useSessionsByDate } from "../hooks/useSessions";
import { sessionsOverlap } from "../lib/colors";
import { todayStr } from "../lib/date";
import type { TaskSession } from "../types";

export function Today() {
  const [date, setDate] = useState(todayStr());
  const { data: sessions = [], isLoading } = useSessionsByDate(date);
  const { data: tasks = [] } = useTasks(false);
  const { create, complete, reschedule } = useSessionMutations();

  const [completeTarget, setCompleteTarget] = useState<TaskSession | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<TaskSession | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    taskId: 0,
    startTime: "09:00",
    endTime: "10:00",
    plannedUnits: 2,
    round: 1,
  });

  const conflicts = useMemo(() => {
    const planned = sessions.filter((s) => s.status === "planned");
    const ids = new Set<number>();
    for (let i = 0; i < planned.length; i++) {
      for (let j = i + 1; j < planned.length; j++) {
        if (
          sessionsOverlap(
            planned[i].start_time,
            planned[i].end_time,
            planned[j].start_time,
            planned[j].end_time,
          )
        ) {
          ids.add(planned[i].id);
          ids.add(planned[j].id);
        }
      }
    }
    return ids;
  }, [sessions]);

  const sorted = useMemo(
    () => [...sessions].sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [sessions],
  );

  const openCreate = () => {
    const first = tasks[0];
    setForm({
      taskId: first?.id ?? 0,
      startTime: "09:00",
      endTime: "10:00",
      plannedUnits: 2,
      round: first?.current_round ?? 1,
    });
    setCreateOpen(true);
  };

  const selectedTask = tasks.find((t) => t.id === form.taskId);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">今日计划</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent-soft"
            onClick={openCreate}
          >
            新建排期
          </button>
        </div>
      </div>

      {conflicts.size > 0 ? (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          有 {conflicts.size} 个排期时段重叠（仅提示，不阻止保存）。
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-ink-muted">加载中…</p>
      ) : sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center">
          <p className="text-ink-muted">这一天还没有排期。</p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm text-white"
            onClick={openCreate}
          >
            创建第一个排期
          </button>
        </div>
      ) : (
        <div className="relative space-y-3 border-l border-white/10 pl-4">
          {sorted.map((s) => (
            <div key={s.id} className="relative">
              <span className="absolute -left-[21px] top-5 h-2.5 w-2.5 rounded-full bg-accent" />
              <SessionCard
                session={s}
                onComplete={() => setCompleteTarget(s)}
                onReschedule={() => setRescheduleTarget(s)}
              />
            </div>
          ))}
        </div>
      )}

      <Modal
        open={createOpen}
        title="新建排期"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-ink-muted"
              onClick={() => setCreateOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-50"
              disabled={!form.taskId || create.isPending}
              onClick={async () => {
                await create.mutateAsync({
                  taskId: form.taskId,
                  date,
                  startTime: form.startTime,
                  endTime: form.endTime,
                  round: form.round,
                  plannedUnits:
                    selectedTask?.type === "side" ? 0 : form.plannedUnits,
                });
                setCreateOpen(false);
              }}
            >
              创建
            </button>
          </>
        }
      >
        {tasks.length === 0 ? (
          <p className="text-sm text-ink-muted">请先创建任务。</p>
        ) : (
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="text-ink-muted">任务</span>
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
                value={form.taskId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  const t = tasks.find((x) => x.id === id);
                  setForm({
                    ...form,
                    taskId: id,
                    round: t?.current_round ?? 1,
                  });
                }}
              >
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.type === "main" ? "[主]" : "[副]"} {t.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-ink-muted">开始</span>
                <input
                  type="time"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
                  value={form.startTime}
                  onChange={(e) =>
                    setForm({ ...form, startTime: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <span className="text-ink-muted">结束</span>
                <input
                  type="time"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                />
              </label>
            </div>
            {selectedTask?.type === "main" ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-ink-muted">轮次</span>
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
                    value={form.round}
                    onChange={(e) =>
                      setForm({ ...form, round: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="block">
                  <span className="text-ink-muted">计划课数</span>
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
                    value={form.plannedUnits}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        plannedUnits: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <CompleteDialog
        session={completeTarget}
        busy={complete.isPending}
        onClose={() => setCompleteTarget(null)}
        onSubmit={async (data) => {
          if (!completeTarget) return;
          const planned = completeTarget.planned_units;
          const result = await complete.mutateAsync({
            sessionId: completeTarget.id,
            actualUnits: data.actualUnits,
            selfRating: data.selfRating,
            selfNote: data.selfNote || null,
            method: data.method,
            deferRemaining: data.deferRemaining,
            deferDate: data.deferDate,
            deferStart: data.deferStart,
            deferEnd: data.deferEnd,
          });
          // 超额时留下弹窗，让成功提示留在屏幕上；满额和部分完成仍直接关掉。
          if (data.actualUnits <= planned) {
            setCompleteTarget(null);
          }
          return result;
        }}
      />

      <RescheduleDialog
        session={rescheduleTarget}
        busy={reschedule.isPending}
        onClose={() => setRescheduleTarget(null)}
        onSubmit={async (data) => {
          if (!rescheduleTarget) return;
          await reschedule.mutateAsync({
            sessionId: rescheduleTarget.id,
            date: data.date,
            startTime: data.startTime,
            endTime: data.endTime,
          });
          setRescheduleTarget(null);
        }}
      />
    </div>
  );
}
