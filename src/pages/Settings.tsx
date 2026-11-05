import { useState } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../api/tauri";
import pkg from "../../package.json";
import { APP_FULL_NAME, APP_NAME } from "../lib/constants";
import { useUiStore } from "../store/ui";
import type { ExamTarget } from "../types";
import { useAchievements, useUserStats } from "../hooks/useStats";
import { format } from "date-fns";

/** 本地日历日，不含时刻。`yyyy-MM-dd` 字符串可直接比较。 */
function isPastLocalDate(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value < format(now, "yyyy-MM-dd");
}

export function Settings() {
  const exams = useUiStore((s) => s.exams);
  const upsertExam = useUiStore((s) => s.upsertExam);
  const setPrimaryExam = useUiStore((s) => s.setPrimaryExam);
  const removeExam = useUiStore((s) => s.removeExam);
  const closeToTray = useUiStore((s) => s.closeToTray);
  const setCloseToTrayStore = useUiStore((s) => s.setCloseToTray);
  const setCloseToTray = (v: boolean) => {
    setCloseToTrayStore(v);
    void api.setCloseToTray(v).catch(() => undefined);
  };
  const alwaysOnTop = useUiStore((s) => s.alwaysOnTop);
  const setAlwaysOnTop = useUiStore((s) => s.setAlwaysOnTop);
  const { data: stats } = useUserStats();
  const { data: achievements = [] } = useAchievements();

  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [msg, setMsg] = useState("");
  const [pendingDate, setPendingDate] = useState<{
    id: string;
    date: string;
  } | null>(null);

  const onExamDateChange = (exam: ExamTarget, next: string) => {
    if (isPastLocalDate(next)) {
      setPendingDate({ id: exam.id, date: next });
      return;
    }
    if (pendingDate?.id === exam.id) setPendingDate(null);
    upsertExam({ ...exam, date: next });
  };

  const confirmPastDate = () => {
    if (!pendingDate) return;
    const current = exams.find((item) => item.id === pendingDate.id);
    if (current) upsertExam({ ...current, date: pendingDate.date });
    setPendingDate(null);
  };

  const toggleAlwaysOnTop = async (v: boolean) => {
    setAlwaysOnTop(v);
    try {
      await getCurrentWindow().setAlwaysOnTop(v);
    } catch {
      /* web preview */
    }
  };

  const exportData = async () => {
    try {
      const json = await api.exportJson();
      const name = `timequest-backup-${format(new Date(), "yyyyMMdd")}.json`;
      const path = await save({
        defaultPath: name,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeTextFile(path, json);
      setMsg("导出成功。文件包含个人学习数据，请妥善保管。");
    } catch (e) {
      setMsg(`导出失败：${String(e)}`);
    }
  };

  const importData = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path || Array.isArray(path)) return;
      if (
        !window.confirm(
          "导入将覆盖当前数据（导入前会自动备份）。确认继续？",
        )
      ) {
        return;
      }
      const json = await readTextFile(path);
      await api.importJson(json);
      setMsg("导入成功，请刷新页面。");
      window.location.reload();
    } catch (e) {
      setMsg(`导入失败：${String(e)}`);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="font-display text-2xl">设置</h1>
        <p className="mt-1 text-sm text-ink-muted">{APP_FULL_NAME}</p>
      </div>

      <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
        <h2 className="font-display text-lg">考试目标</h2>
        <ul className="mt-3 space-y-2">
          {exams.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-3/60 px-3 py-2 text-sm"
            >
              <input
                type="radio"
                name="primary"
                checked={e.isPrimary}
                onChange={() => setPrimaryExam(e.id)}
              />
              <input
                className="min-w-0 flex-1 rounded border border-white/10 bg-surface px-2 py-1"
                value={e.name}
                onChange={(ev) =>
                  upsertExam({ ...e, name: ev.target.value })
                }
              />
              <input
                type="date"
                className="rounded border border-white/10 bg-surface px-2 py-1"
                value={pendingDate?.id === e.id ? pendingDate.date : e.date}
                onChange={(ev) => onExamDateChange(e, ev.target.value)}
              />
              {exams.length > 1 ? (
                <button
                  type="button"
                  className="text-ink-muted hover:text-ink"
                  onClick={() => removeExam(e.id)}
                >
                  删除
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {pendingDate ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="past-exam-date-title"
            className="mt-3 rounded-xl border border-white/10 bg-surface p-3 text-sm"
          >
            <p id="past-exam-date-title">这个日期已过去</p>
            <p className="mt-1 text-ink-muted">
              倒计时将显示「已到达」。确认仍使用这个日期吗？
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white"
                onClick={confirmPastDate}
              >
                确认
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm"
                onClick={() => setPendingDate(null)}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            placeholder="名称（如模考）"
            className="rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            type="date"
            className="rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-2 text-sm text-white"
            onClick={() => {
              if (!newName || !newDate) return;
              upsertExam({
                id: `exam-${Date.now()}`,
                name: newName,
                date: newDate,
                isPrimary: false,
              });
              setNewName("");
              setNewDate("");
            }}
          >
            添加
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4 space-y-3">
        <h2 className="font-display text-lg">窗口与托盘</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={closeToTray}
            onChange={(e) => setCloseToTray(e.target.checked)}
          />
          关闭窗口时最小化到托盘（而非退出）
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={alwaysOnTop}
            onChange={(e) => toggleAlwaysOnTop(e.target.checked)}
          />
          窗口置顶
        </label>
      </section>

      <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
        <h2 className="font-display text-lg">数据管理</h2>
        <p className="mt-1 text-xs text-ink-muted">
          导出文件包含个人学习数据，请勿随意分享。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-2 text-sm text-white"
            onClick={exportData}
          >
            导出 JSON
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/15 px-3 py-2 text-sm"
            onClick={importData}
          >
            导入 JSON
          </button>
        </div>
        {msg ? <p className="mt-3 text-sm text-ink-muted">{msg}</p> : null}
      </section>

      <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
        <h2 className="font-display text-lg">进度概览</h2>
        {stats ? (
          <p className="mt-2 text-sm text-ink-muted">
            Lv.{stats.current_level} · {stats.total_xp} XP · 连击{" "}
            {stats.current_streak}（最长 {stats.longest_streak}）
          </p>
        ) : null}
        <ul className="mt-3 space-y-1 text-sm">
          {achievements.length === 0 ? (
            <li className="text-ink-muted">尚未解锁成就</li>
          ) : (
            achievements.map((a) => (
              <li key={a.achievement_id}>
                {a.name ?? a.achievement_id}
                <span className="ml-2 text-xs text-ink-muted">
                  {a.unlocked_at}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      <p className="text-center text-xs text-ink-muted">
        {APP_NAME} v{pkg.version} · 本地优先 · 无账号
      </p>
    </div>
  );
}
