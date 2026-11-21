import { useState } from "react";
import { Modal } from "./Modal";
import { TextbookCombobox } from "./TextbookCombobox";
import { SUBJECTS } from "../lib/constants";
import { TASK_PALETTE } from "../lib/colors";
import type { Task, TaskType } from "../types";

/** 新建任务时的默认总课数。 */
export const DEFAULT_TOTAL_UNITS = 40;

export type TaskFormValues = {
  title: string;
  type: TaskType;
  subject: string;
  textbook: string;
  unit_name: string;
  total_units: number;
  total_rounds: number;
  color: string;
};

const TITLE_REQUIRED = "请给任务起个名字，例如「物理必修二 第一轮」";

function blankForm(): TaskFormValues {
  return {
    title: "",
    type: "main",
    subject: "数学",
    textbook: "",
    unit_name: "课",
    total_units: DEFAULT_TOTAL_UNITS,
    total_rounds: 2,
    color: TASK_PALETTE[0],
  };
}

function formOf(task: Task): TaskFormValues {
  return {
    title: task.title,
    type: task.type,
    subject: task.subject ?? "数学",
    textbook: task.textbook ?? "",
    unit_name: task.unit_name,
    total_units: task.total_units ?? DEFAULT_TOTAL_UNITS,
    total_rounds: task.total_rounds,
    color: task.color ?? TASK_PALETTE[0],
  };
}

/**
 * 任务表单弹窗。新建和编辑共用一套字段：
 *
 * - `mode="create"`：能选主线 / 副本，主线才有科目、课本、总课数、总轮次。
 * - `mode="edit"`：预填已有任务；主线/副本不能改（后端 `update_task` 也不支持改类型）。
 *
 * 组件由父级条件渲染，打开时是新挂载的，所以初始值直接来自 `initial`，
 * 不用 effect 重置，编辑时也不会把用户正在输入的内容冲掉。
 */
export function TaskFormModal({
  mode,
  initial,
  onClose,
  onSubmit,
  submitting = false,
}: {
  mode: "create" | "edit";
  /** 编辑模式下的原任务。 */
  initial?: Task | null;
  onClose: () => void;
  onSubmit: (values: TaskFormValues) => void | Promise<void>;
  submitting?: boolean;
}) {
  const [form, setForm] = useState<TaskFormValues>(() =>
    initial ? formOf(initial) : blankForm(),
  );
  const [titleError, setTitleError] = useState<string | null>(null);

  const isMain = form.type === "main";
  const editing = mode === "edit";

  const submit = async () => {
    const title = form.title.trim();
    // 防呆：空标题直接拦下并说清楚，而不是点了没反应。
    if (!title) {
      setTitleError(TITLE_REQUIRED);
      return;
    }
    setTitleError(null);
    await onSubmit({ ...form, title });
  };

  return (
    <Modal
      open
      title={editing ? "编辑任务" : "新建任务"}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-ink-muted"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-50"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {editing ? "保存" : "创建"}
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
            aria-invalid={titleError != null}
            onChange={(e) => {
              setForm({ ...form, title: e.target.value });
              if (titleError) setTitleError(null);
            }}
          />
        </label>
        {titleError ? (
          <p className="mt-1 text-sm text-amber-200" role="alert">
            {titleError}
          </p>
        ) : null}
        {!editing ? (
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
        ) : null}
        {isMain ? (
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
                    ...(editing ? {} : { total_units: DEFAULT_TOTAL_UNITS }),
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
                  // 编辑时不改总课数：这个数可能已经跑了进度，别让换本书把它冲掉。
                  ...(editing || totalUnits == null ? {} : { total_units: totalUnits }),
                }))
              }
            />
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="text-ink-muted">单位</span>
                <input
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-2 py-2 text-ink outline-none hover:border-white/20 focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  value={form.unit_name}
                  onChange={(e) => setForm({ ...form, unit_name: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-ink-muted">总课数</span>
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-2 py-2 text-ink outline-none hover:border-white/20 focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  value={form.total_units}
                  onChange={(e) => setForm({ ...form, total_units: Number(e.target.value) })}
                />
              </label>
              <label className="block">
                <span className="text-ink-muted">总轮次</span>
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-2 py-2 text-ink outline-none hover:border-white/20 focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  value={form.total_rounds}
                  onChange={(e) => setForm({ ...form, total_rounds: Number(e.target.value) })}
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
                aria-label={`颜色 ${c}`}
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
  );
}
