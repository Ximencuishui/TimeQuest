import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TaskProgressRing } from "../components/ProgressRing";
import { Modal } from "../components/Modal";
import { useTaskMutations, useTasks } from "../hooks/useTasks";
import { SUBJECTS } from "../lib/constants";
import { TASK_PALETTE } from "../lib/colors";
import type { Task, TaskType } from "../types";

export function Tasks() {
  const { data: tasks = [], isLoading } = useTasks(false);
  const { create } = useTaskMutations();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    type: "main" as TaskType,
    subject: "数学",
    textbook: "",
    unit_name: "课",
    total_units: 40,
    total_rounds: 2,
    color: TASK_PALETTE[0],
  });

  const main = useMemo(() => tasks.filter((t) => t.type === "main"), [tasks]);
  const side = useMemo(() => tasks.filter((t) => t.type === "side"), [tasks]);

  const submit = async () => {
    if (!form.title.trim()) return;
    await create.mutateAsync({
      title: form.title.trim(),
      type: form.type,
      subject: form.type === "main" ? form.subject : null,
      textbook: form.type === "main" ? form.textbook || null : null,
      unit_name: form.unit_name,
      total_units: form.type === "main" ? form.total_units : null,
      total_rounds: form.type === "main" ? form.total_rounds : 1,
      color: form.color,
    });
    setOpen(false);
    setForm((f) => ({ ...f, title: "", textbook: "" }));
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-display text-2xl">任务</h1>
        <button
          type="button"
          className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent-soft"
          onClick={() => setOpen(true)}
        >
          新建任务
        </button>
      </div>

      {isLoading ? (
        <p className="text-ink-muted">加载中…</p>
      ) : (
        <div className="space-y-8">
          <TaskGroup title="主线" items={main} />
          <TaskGroup title="副本" items={side} />
        </div>
      )}

      <Modal
        open={open}
        title="新建任务"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-ink-muted"
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-accent px-4 py-2 text-white"
              onClick={submit}
              disabled={create.isPending}
            >
              创建
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-ink-muted">标题</span>
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <div className="flex gap-2">
            {(["main", "side"] as TaskType[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`rounded-lg px-3 py-1.5 ${
                  form.type === t ? "bg-accent text-white" : "bg-white/5"
                }`}
                onClick={() => setForm({ ...form, type: t })}
              >
                {t === "main" ? "主线" : "副本"}
              </button>
            ))}
          </div>
          {form.type === "main" ? (
            <>
              <label className="block">
                <span className="text-ink-muted">科目</span>
                <select
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                >
                  {SUBJECTS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-ink-muted">课本</span>
                <input
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
                  value={form.textbook}
                  onChange={(e) =>
                    setForm({ ...form, textbook: e.target.value })
                  }
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-ink-muted">单位</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-2 py-2"
                    value={form.unit_name}
                    onChange={(e) =>
                      setForm({ ...form, unit_name: e.target.value })
                    }
                  />
                </label>
                <label className="block">
                  <span className="text-ink-muted">总课数</span>
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-2 py-2"
                    value={form.total_units}
                    onChange={(e) =>
                      setForm({ ...form, total_units: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="block">
                  <span className="text-ink-muted">总轮次</span>
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-2 py-2"
                    value={form.total_rounds}
                    onChange={(e) =>
                      setForm({ ...form, total_rounds: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
            </>
          ) : null}
          <div>
            <span className="text-ink-muted">颜色</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {TASK_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`h-7 w-7 rounded-full ${
                    form.color === c ? "ring-2 ring-white" : ""
                  }`}
                  style={{ background: c }}
                  onClick={() => setForm({ ...form, color: c })}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>
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
