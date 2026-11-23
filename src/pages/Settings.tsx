import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../api/tauri";
import pkg from "../../package.json";
import { APP_FULL_NAME, APP_NAME } from "../lib/constants";
import { useUiStore } from "../store/ui";
import type { Goal } from "../types";
import { useGoalMutations, useGoals } from "../hooks/useGoals";
import { useAchievements, useUserStats } from "../hooks/useStats";
import { useAppSetting, useSetSetting } from "../hooks/useAppSetting";
import { todayStr } from "../lib/date";
import { dailyMotivation } from "../lib/motivation";
import { format } from "date-fns";
import { ProfileSetting } from "../components/ProfileSetting";
import { TrackSetting } from "../components/TrackSetting";
import { DailyPlanSetting } from "../components/DailyPlanSetting";
import { TimePresetEditor } from "../components/TimePresetEditor";
import { DurationPresetEditor } from "../components/DurationPresetEditor";
import { GlossaryList } from "../components/GlossaryList";
import { useHasMockData } from "../hooks/useMockData";
import { useTimePresets } from "../hooks/useTimePresets";
import { formatTimePresetLabel, summarizeTimeShift } from "../lib/timePresets";
import { useDurationPresets } from "../hooks/useDurationPresets";
import { formatDurationPresetLabel, summarizeDurationShift } from "../lib/durationPresets";
import {
  AUTO_SCHEDULE_SETTING_KEY,
  isAutoScheduleEnabled,
} from "../lib/studyPlan";
import {
  CELEBRATIONS_SETTING_KEY,
  isCelebrationsEnabled,
} from "../lib/celebration";

const MOTIVATION_KEY = "motivation_text";

function MotivationSetting() {
  const { data } = useAppSetting(MOTIVATION_KEY);
  const setSetting = useSetSetting(MOTIVATION_KEY);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? data ?? "";
  const showingDefault = value.trim() === "";
  const todayLine = dailyMotivation(todayStr());

  const save = (next: string) => {
    setSetting.mutate(next);
  };

  return (
    <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
      <h2 className="font-display text-lg">每日激励语</h2>
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          save(value);
        }}
      >
        <label htmlFor="motivation-text" className="block text-sm">
          自定义激励语
        </label>
        <input
          id="motivation-text"
          className="w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
          value={value}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-lg bg-accent px-3 py-2 text-sm text-white"
          >
            保存
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/15 px-3 py-2 text-sm"
            onClick={() => {
              setDraft("");
              save("");
            }}
          >
            清空
          </button>
        </div>
        <p id="motivation-hint" className="text-sm text-zinc-400">
          {showingDefault ? (
            <>
              今天的默认句：「<span className="italic">{todayLine}</span>」
            </>
          ) : (
            "清空后恢复每天自动更换的默认句。"
          )}
        </p>
      </form>
    </section>
  );
}

function CelebrationsSetting() {
  const { data, isFetched } = useAppSetting(CELEBRATIONS_SETTING_KEY);
  const setSetting = useSetSetting(CELEBRATIONS_SETTING_KEY);
  const enabled = isCelebrationsEnabled(isFetched ? data : null);

  return (
    <section className="space-y-3 rounded-2xl border border-white/5 bg-surface-2/80 p-4">
      <h2 className="font-display text-lg">里程碑特效</h2>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!isFetched}
          onChange={(event) => {
            setSetting.mutate(event.target.checked ? "1" : "0");
          }}
        />
        启用里程碑特效
      </label>
      <p className="text-xs text-ink-muted">
        主线通关，或连击达到 7、14、30 天时，播放烟花和音效。默认开启。
      </p>
    </section>
  );
}

/**
 * 常用时段：排期时点一下就能填好一整块时间。
 *
 * 与「每日可用时段」的区别：那边是给自动排期用的整段窗口，
 * 这边是学生手动排期时的快捷按钮，两边互不干扰。
 */
function TimePresetsSetting() {
  const { presets } = useTimePresets();
  const [editorOpen, setEditorOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  return (
    <section className="space-y-3 rounded-2xl border border-white/5 bg-surface-2/80 p-4">
      <h2 className="font-display text-lg">常用时段</h2>
      <p className="text-xs text-ink-muted">
        排期时点一下就能填好一整块时间。改完保存后全局生效：今天及以后排在这个旧时段上的场次会一起挪到新时段，已完成的历史不动。
      </p>
      <div className="flex flex-wrap gap-1.5">
        {presets.length === 0 ? (
          <span className="text-sm text-ink-muted">还没有常用时段。</span>
        ) : null}
        {presets.map((preset) => (
          <span
            key={preset.id}
            className="rounded-lg border border-white/10 bg-surface-3 px-2 py-1 text-xs text-ink-muted"
          >
            {formatTimePresetLabel(preset)}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="rounded-lg border border-white/15 px-3 py-2 text-sm"
        onClick={() => setEditorOpen(true)}
      >
        编辑常用时段
      </button>
      {summary ? <p className="text-xs text-ink-muted">{summary}</p> : null}
      <TimePresetEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={(result) => {
          setSummary(summarizeTimeShift(result));
        }}
      />
    </section>
  );
}

/**
 * 常用时长：排期时点一下就能定好「这一场学多久」。
 *
 * 默认值按番茄钟算法生成（25 分钟专注 + 5 分钟短休息，4 个番茄一轮），
 * 可以改成自己的节奏；改完保存后全局生效。
 */
function DurationPresetsSetting() {
  const { presets } = useDurationPresets();
  const [editorOpen, setEditorOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  return (
    <section className="space-y-3 rounded-2xl border border-white/5 bg-surface-2/80 p-4">
      <h2 className="font-display text-lg">常用时长</h2>
      <p className="text-xs text-ink-muted">
        默认按番茄钟算法推荐（25 分钟专注 + 5 分钟短休息，4 个番茄一轮）。
        改完保存后全局生效：今天及以后排在这个旧时长上的场次会一起改成新时长，已完成的历史不动。
      </p>
      <div className="flex flex-wrap gap-1.5">
        {presets.length === 0 ? (
          <span className="text-sm text-ink-muted">还没有常用时长。</span>
        ) : null}
        {presets.map((preset) => (
          <span
            key={preset.id}
            className="rounded-lg border border-white/10 bg-surface-3 px-2 py-1 text-xs text-ink-muted"
          >
            {formatDurationPresetLabel(preset)}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="rounded-lg border border-white/15 px-3 py-2 text-sm"
        onClick={() => setEditorOpen(true)}
      >
        编辑常用时长
      </button>
      {summary ? <p className="text-xs text-ink-muted">{summary}</p> : null}
      <DurationPresetEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={(result) => {
          setSummary(summarizeDurationShift(result));
        }}
      />
    </section>
  );
}

function AutoScheduleSetting() {
  const { data, isFetched } = useAppSetting(AUTO_SCHEDULE_SETTING_KEY);
  const setSetting = useSetSetting(AUTO_SCHEDULE_SETTING_KEY);
  const enabled = isAutoScheduleEnabled(isFetched ? data : null);

  return (
    <section className="space-y-3 rounded-2xl border border-white/5 bg-surface-2/80 p-4">
      <h2 className="font-display text-lg">自动排期</h2>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!isFetched}
          onChange={(event) => {
            setSetting.mutate(event.target.checked ? "1" : "0");
          }}
        />
        启动时自动排今天的计划
      </label>
      <p className="text-xs text-ink-muted">
        今天还没有任何安排时，按上面的「每日可用时段」把主线任务排进今天。
        今天已经排过了就不动它。默认开启。
      </p>
    </section>
  );
}

/** 本地日历日，不含时刻。`yyyy-MM-dd` 字符串可直接比较。 */
function isPastLocalDate(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value < format(now, "yyyy-MM-dd");
}

export function Settings() {
  const { data: goals = [] } = useGoals();
  const { upsert, remove, setPrimary } = useGoalMutations();
  const closeToTray = useUiStore((s) => s.closeToTray);
  const setCloseToTrayStore = useUiStore((s) => s.setCloseToTray);
  const setCloseToTray = (v: boolean) => {
    setCloseToTrayStore(v);
    void api.setCloseToTray(v).catch(() => undefined);
  };
  const alwaysOnTop = useUiStore((s) => s.alwaysOnTop);
  const setAlwaysOnTop = useUiStore((s) => s.setAlwaysOnTop);
  const notificationsEnabled = useUiStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useUiStore((s) => s.setNotificationsEnabled);
  const { data: stats } = useUserStats();
  const { data: achievementsData } = useAchievements();
  // 防御后端异常返回 null：achievements.length 抛错会让整棵树卸载白屏。
  const achievements = achievementsData ?? [];
  const { data: hasMock } = useHasMockData();
  const queryClient = useQueryClient();
  const mockHighlighted = hasMock === true;

  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [msg, setMsg] = useState("");
  const [pendingDate, setPendingDate] = useState<{
    id: number;
    date: string;
  } | null>(null);
  // 名称框先在本地改，失焦时才写库：每敲一个字写一次数据库太吵。
  const [nameDraft, setNameDraft] = useState<{
    id: number;
    value: string;
  } | null>(null);

  const onGoalDateChange = (goal: Goal, next: string) => {
    if (isPastLocalDate(next)) {
      setPendingDate({ id: goal.id, date: next });
      return;
    }
    if (pendingDate?.id === goal.id) setPendingDate(null);
    upsert.mutate({
      id: goal.id,
      name: goal.name,
      date: next,
      kind: goal.kind,
      isPrimary: goal.isPrimary,
      targetScore: goal.targetScore,
    });
  };

  const confirmPastDate = () => {
    if (!pendingDate) return;
    const current = goals.find((item) => item.id === pendingDate.id);
    if (current) {
      upsert.mutate({
        id: current.id,
        name: current.name,
        date: pendingDate.date,
        kind: current.kind,
        isPrimary: current.isPrimary,
        targetScore: current.targetScore,
      });
    }
    setPendingDate(null);
  };

  const commitName = (goal: Goal) => {
    if (!nameDraft || nameDraft.id !== goal.id) return;
    const next = nameDraft.value.trim();
    setNameDraft(null);
    if (!next || next === goal.name) return;
    upsert.mutate({
      id: goal.id,
      name: next,
      date: goal.date,
      kind: goal.kind,
      isPrimary: goal.isPrimary,
      targetScore: goal.targetScore,
    });
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

  const clearMock = async () => {
    if (
      !window.confirm(
        "将删除所有演示任务、排期和考试成绩。真实记录会保留。如果除此之外没有真实记录，经验和连击会回到起点。确认清除？",
      )
    ) {
      return;
    }
    try {
      await api.clearMockData();
      await queryClient.invalidateQueries({ queryKey: ["hasMockData"] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["sessions-range"] });
      await queryClient.invalidateQueries({ queryKey: ["user-stats"] });
      await queryClient.invalidateQueries({ queryKey: ["examRecords"] });
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
      setMsg("演示数据已清除。");
    } catch (e) {
      setMsg(`清除失败：${String(e)}`);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="font-display text-2xl">设置</h1>
        <p className="mt-1 text-sm text-ink-muted">{APP_FULL_NAME}</p>
      </div>

      <TrackSetting />

      <ProfileSetting />

      <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
        <h2 className="font-display text-lg">考试目标</h2>
        <p className="mt-1 text-xs text-ink-muted">
          除高考外添加的目标（比如模考）会在首页显示倒计时，帮你盯住最近的一次考试。
        </p>
        <ul className="mt-3 space-y-2">
          {goals.map((goal) => (
            <li
              key={goal.id}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-3/60 px-3 py-2 text-sm"
            >
              <input
                type="radio"
                name="primary"
                checked={goal.isPrimary}
                onChange={() => setPrimary.mutate(goal.id)}
              />
              <input
                className="min-w-0 flex-1 rounded border border-white/10 bg-surface px-2 py-1"
                value={nameDraft?.id === goal.id ? nameDraft.value : goal.name}
                onChange={(ev) =>
                  setNameDraft({ id: goal.id, value: ev.target.value })
                }
                onBlur={() => commitName(goal)}
              />
              <input
                type="date"
                className="rounded border border-white/10 bg-surface px-2 py-1"
                value={pendingDate?.id === goal.id ? pendingDate.date : goal.date}
                onChange={(ev) => onGoalDateChange(goal, ev.target.value)}
              />
              {goals.length > 1 ? (
                <button
                  type="button"
                  className="text-ink-muted hover:text-ink"
                  onClick={() => remove.mutate(goal.id)}
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
              upsert.mutate({
                name: newName,
                date: newDate,
                kind: "exam",
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

      <MotivationSetting />

      <DailyPlanSetting />

      <TimePresetsSetting />

      <DurationPresetsSetting />

      <AutoScheduleSetting />

      <GlossaryList />

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

      <section className="space-y-3 rounded-2xl border border-white/5 bg-surface-2/80 p-4">
        <h2 className="font-display text-lg">系统通知</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notificationsEnabled}
            onChange={(e) => setNotificationsEnabled(e.target.checked)}
          />
          系统通知
        </label>
        <p className="text-xs text-ink-muted">
          课前 5 分钟和开课时弹出系统提醒。默认开启。
        </p>
      </section>

      <CelebrationsSetting />

      <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
        <h2 className="font-display text-lg">数据管理</h2>
        <p className="mt-1 text-xs text-ink-muted">
          导出文件包含个人学习数据，请勿随意分享。
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          应用已为您开启每日自动备份，保留最近 7 天的数据。
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
          <button
            type="button"
            data-highlighted={mockHighlighted ? "true" : "false"}
            className={
              mockHighlighted
                ? "rounded-lg bg-accent px-3 py-2 text-sm text-white"
                : "rounded-lg border border-white/15 px-3 py-2 text-sm text-ink-muted"
            }
            onClick={() => void clearMock()}
          >
            清除所有演示数据
          </button>
        </div>
        {mockHighlighted ? (
          <p className="mt-2 text-xs text-accent-soft">
            当前有演示数据。清除只会去掉这些演示记录。
          </p>
        ) : null}
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
