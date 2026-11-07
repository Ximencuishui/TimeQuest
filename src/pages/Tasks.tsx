import { useEffect, useState, type ReactNode } from "react";
import { KnowledgePointDrawer, type KnowledgeTask } from "../components/KnowledgePointDrawer";
import { TaskGridView } from "../components/TaskGridView";
import { TaskListView } from "../components/TaskListView";
import { Modal } from "../components/Modal";
import { TextbookCombobox } from "../components/TextbookCombobox";
import { TextbookImportWizard } from "../components/TextbookImportWizard";
import { useTaskMutations, useTasks } from "../hooks/useTasks";
import { SUBJECTS } from "../lib/constants";
import { TASK_PALETTE } from "../lib/colors";
import { useUiStore } from "../store/ui";
import type { TaskType } from "../types";

const DEFAULT_TOTAL_UNITS = 40;

export function Tasks() {
  const { data: tasks = [], isLoading } = useTasks(false);
  const taskView = useUiStore((s) => s.taskView);
  const setTaskView = useUiStore((s) => s.setTaskView);
  const { create } = useTaskMutations();
  const [open, setOpen] = useState(false);
  const [knowledgeTask, setKnowledgeTask] = useState<KnowledgeTask | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    type: "main" as TaskType,
    subject: "数学",
    textbook: "",
    unit_name: "课",
    total_units: DEFAULT_TOTAL_UNITS,
    total_rounds: 2,
    color: TASK_PALETTE[0],
  });

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl">任务</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex rounded-lg border border-white/10 p-0.5">
            <ViewButton
              label="列表视图"
              active={taskView === "list"}
              onClick={() => setTaskView("list")}
            >
              <ListIcon />
            </ViewButton>
            <ViewButton
              label="网格视图"
              active={taskView === "grid"}
              onClick={() => setTaskView("grid")}
            >
              <GridIcon />
            </ViewButton>
          </div>
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent-soft"
            onClick={() => setImportOpen(true)}
          >
            从教材导入
          </button>
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent-soft"
            onClick={() => setOpen(true)}
          >
            新建任务
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-ink-muted">加载中…</p>
      ) : taskView === "list" ? (
        <TaskListView tasks={tasks} onOpenKnowledge={setKnowledgeTask} />
      ) : (
        <TaskGridView tasks={tasks} onOpenKnowledge={setKnowledgeTask} />
      )}

      <KnowledgePointDrawer task={knowledgeTask} onClose={() => setKnowledgeTask(null)} />

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
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-ink outline-none hover:border-white/20 focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
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
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-ink outline-none hover:border-white/20 focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  value={form.subject}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      subject: e.target.value,
                      textbook: "",
                      total_units: DEFAULT_TOTAL_UNITS,
                    }))
                  }
                >
                  {SUBJECTS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <TextbookCombobox
                subject={form.subject}
                value={form.textbook}
                onChange={(textbook) => setForm((current) => ({ ...current, textbook }))}
                onPick={(book, totalUnits) =>
                  setForm((current) => ({
                    ...current,
                    textbook: book.volume,
                    subject: book.subject,
                    ...(totalUnits != null ? { total_units: totalUnits } : {}),
                  }))
                }
              />
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-ink-muted">单位</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-2 py-2 text-ink outline-none hover:border-white/20 focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
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
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-2 py-2 text-ink outline-none hover:border-white/20 focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
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
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-2 py-2 text-ink outline-none hover:border-white/20 focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
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
      {toast ? (
        <p
          role="status"
          className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-lg border border-accent/40 bg-surface-2 px-4 py-2 text-sm text-ink shadow-lg"
        >
          {toast}
        </p>
      ) : null}
      {importOpen ? (
        <TextbookImportWizard
          onClose={() => setImportOpen(false)}
          onCreated={(plannedCount, autoSchedule) => {
            setImportOpen(false);
            setToast(
              autoSchedule
                ? `任务创建成功，已生成 ${plannedCount} 个排期。`
                : "任务创建成功。",
            );
          }}
        />
      ) : null}
    </div>
  );
}

function ViewButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`rounded-md p-1.5 ${
        active ? "bg-white/10 text-ink" : "text-ink-muted hover:text-ink"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M8 7h11M8 12h11M8 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01"
      />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        d="M5 5h5.5v5.5H5zM13.5 5H19v5.5h-5.5zM5 13.5h5.5V19H5zM13.5 13.5H19V19h-5.5z"
      />
    </svg>
  );
}
