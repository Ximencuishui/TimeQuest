import { useState } from "react";
import { useTaskMutations } from "../hooks/useTasks";
import type { Task } from "../types";
import { Modal } from "./Modal";
import { TaskFormModal, type TaskFormValues } from "./TaskFormModal";

/**
 * 任务的三个高频动作：编辑、搁置（冻结）、删除。
 *
 * 详情页和知识点抽屉共用一套，避免两个入口的语义漂移。
 * 删除 = 移入回收站：任务还在，只是从计划里收起来，随时能找回来，
 * 所以确认框要说清楚「能找回」，而不是吓唬人。
 */
export function TaskActionBar({
  task,
  onDeleted,
  onEdited,
  compact = false,
}: {
  task: Task;
  /** 删除成功后回调：详情页跳回列表，抽屉关掉自己。 */
  onDeleted?: () => void;
  /** 编辑保存成功后回调。 */
  onEdited?: () => void;
  /** 抽屉里空间小，按钮用小一号。 */
  compact?: boolean;
}) {
  const { archive, remove, update } = useTaskMutations();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buttonClass = compact
    ? "rounded-lg border border-white/15 px-2.5 py-1 text-xs hover:bg-white/5"
    : "rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5";
  const dangerClass = compact
    ? "rounded-lg border border-rose-500/40 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
    : "rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-500/10";

  const saveEdit = async (values: TaskFormValues) => {
    const isMain = task.type === "main";
    await update.mutateAsync({
      id: task.id,
      payload: {
        title: values.title,
        color: values.color,
        // 副本任务没有科目 / 课本 / 总课数，只改得到标题和颜色。
        ...(isMain
          ? {
              subject: values.subject,
              // 课本传空串 = 清空，后端把它归回 NULL。
              textbook: values.textbook,
              unit_name: values.unit_name,
              total_units: values.total_units,
              total_rounds: values.total_rounds,
            }
          : {}),
      },
    });
    setEditing(false);
    onEdited?.();
  };

  const confirmDelete = async () => {
    setError(null);
    try {
      await remove.mutateAsync(task.id);
      setConfirming(false);
      onDeleted?.();
    } catch (err) {
      setError(
        typeof err === "string" && err.trim()
          ? err
          : err instanceof Error && err.message.trim()
            ? err.message
            : "删除失败，请稍后再试。",
      );
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => setEditing(true)}
        >
          编辑
        </button>
        <button
          type="button"
          className={buttonClass}
          title={
            task.archived
              ? "把任务放回计划里继续推进"
              : "暂时不学这个任务，收起来但保留记录"
          }
          onClick={() =>
            archive.mutate({ id: task.id, archived: !task.archived })
          }
        >
          {task.archived ? "取消搁置" : "搁置"}
        </button>
        <button
          type="button"
          className={dangerClass}
          title="移到回收站，随时可以找回来"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          删除
        </button>
      </div>

      {editing ? (
        <TaskFormModal
          mode="edit"
          initial={task}
          onClose={() => setEditing(false)}
          onSubmit={saveEdit}
          submitting={update.isPending}
        />
      ) : null}

      <Modal
        open={confirming}
        title="把任务移到回收站？"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <button
              type="button"
              className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-ink-muted hover:bg-white/5"
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm text-white hover:bg-rose-400 disabled:opacity-50"
              disabled={remove.isPending}
              onClick={() => void confirmDelete()}
            >
              移到回收站
            </button>
          </>
        }
      >
        <p className="text-sm text-ink">
          「{task.title}」会从计划里收起来，排期和学习记录都留着，之后可以在总计划页的「回收站」里随时找回来。
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          如果只是暂时不学，用「搁置」就好：它会留在计划里原位，随时能接着推进。
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-rose-300">
            {error}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
