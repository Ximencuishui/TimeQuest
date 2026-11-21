import { useState } from "react";
import { useDeletedTasks, useTaskMutations } from "../hooks/useTasks";
import type { Task } from "../types";
import { Modal } from "./Modal";

/**
 * 回收站：被删掉的任务都在这儿，随时能找回来。
 *
 * 删除只是把任务从计划里收起来，排期与学习记录都留着，
 * 恢复后原样回到原来的位置（原本是搁置状态就仍然是搁置状态）。
 *
 * 「彻底清除」是另一条路：物理删除，真的没了，所以要再确认一次。
 */
export function RecycleBin({ onRestored }: { onRestored?: (task: Task) => void }) {
  const { data: tasks = [], isLoading } = useDeletedTasks();
  const { restoreFromTrash, purge } = useTaskMutations();
  const [purging, setPurging] = useState<Task | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  const errorText = (err: unknown, fallback: string) => {
    if (typeof err === "string" && err.trim()) return err;
    if (err instanceof Error && err.message.trim()) return err.message;
    return fallback;
  };

  const restore = async (task: Task) => {
    setRestoreError(null);
    try {
      await restoreFromTrash.mutateAsync(task.id);
      onRestored?.(task);
    } catch (err) {
      // 失败要看得见：任务还在回收站里，用户得知道为什么没找回来。
      setRestoreError(errorText(err, "找回来失败，请稍后再试。"));
    }
  };

  const confirmPurge = async () => {
    if (!purging) return;
    setPurgeError(null);
    try {
      await purge.mutateAsync(purging.id);
      setPurging(null);
    } catch (err) {
      setPurgeError(errorText(err, "彻底清除失败，请稍后再试。"));
    }
  };

  return (
    <>
      <section
        aria-label="回收站"
        data-testid="recycle-bin"
        className="mt-6 rounded-xl border border-white/5 bg-surface-2/60 px-3 py-3"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-ink">回收站</h2>
          <span className="text-[11px] text-ink-muted">
            {tasks.length} 个任务
          </span>
        </div>
        {restoreError ? (
          <p role="alert" className="mt-2 text-xs text-rose-300">
            {restoreError}
          </p>
        ) : null}
        {isLoading ? (
          <p className="text-xs text-ink-muted">加载中…</p>
        ) : tasks.length === 0 ? (
          <p className="text-xs text-ink-muted">
            回收站是空的。删掉的任务会先放到这里，随时能找回来。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/5 px-2.5 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{task.title}</p>
                  <p className="text-[11px] text-ink-muted">
                    {task.deleted_at
                      ? `已于 ${task.deleted_at.slice(0, 10)} 移到回收站`
                      : "已移到回收站"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-ink hover:bg-white/5 disabled:opacity-50"
                    disabled={restoreFromTrash.isPending}
                    onClick={() => void restore(task)}
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
                    title="彻底删除，无法恢复"
                    onClick={() => {
                      setPurgeError(null);
                      setPurging(task);
                    }}
                  >
                    彻底清除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={purging != null}
        title="彻底删除这个任务？"
        onClose={() => setPurging(null)}
        footer={
          <>
            <button
              type="button"
              className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-ink-muted hover:bg-white/5"
              onClick={() => setPurging(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm text-white hover:bg-rose-400 disabled:opacity-50"
              disabled={purge.isPending}
              onClick={() => void confirmPurge()}
            >
              彻底删除
            </button>
          </>
        }
      >
        <p className="text-sm text-ink">
          「{purging?.title}」的排期、学习记录和考点都会一起删掉，无法恢复。
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          如果只是想让它从计划里消失，用「恢复」把它找回来就够了。
        </p>
        {purgeError ? (
          <p role="alert" className="mt-2 text-sm text-rose-300">
            {purgeError}
          </p>
        ) : null}
      </Modal>
    </>
  );
}