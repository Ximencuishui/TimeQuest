import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/tauri";
import { useDurationPresets, usePomodoroPlan } from "../hooks/useDurationPresets";
import { todayStr } from "../lib/date";
import {
  DEFAULT_DURATION_PRESETS,
  DEFAULT_POMODORO_PLAN,
  buildPomodoroDurations,
  diffDurationPresets,
  formatDurationPresetLabel,
  isValidDurationPreset,
  newDurationPresetId,
  normalizePomodoroPlan,
  type DurationPreset,
  type PomodoroPlan,
} from "../lib/durationPresets";
import type { PresetDurationShiftResult } from "../types";
import { broadcastSessionUpdated } from "../lib/widgetWindow";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  onClose: () => void;
  /** 保存后回报：计划被同步了多少场。 */
  onSaved?: (result: PresetDurationShiftResult) => void;
};

/**
 * 常用时长编辑器。
 *
 * 学生自己定一组「学多久」，保存后全局生效：新建排期、改期都用这一组。
 * 默认值来自番茄钟算法（25 分钟专注 + 5 分钟短休息，4 个番茄一轮），
 * 也可以按自己的番茄钟参数重新生成。
 *
 * 保存时会把「改了分钟数的旧时长」交给后端批量改期：
 * 今天及以后排在这个旧时长上的场次一起改到新时长，
 * 已经完成的历史不动，改过去会撞车的保持原样。
 */
export function DurationPresetEditor({ open, onClose, onSaved }: Props) {
  const { presets: stored, savePresets } = useDurationPresets();
  const { plan: storedPlan, savePlan } = usePomodoroPlan();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<DurationPreset[]>([]);
  const [plan, setPlan] = useState<PomodoroPlan>(DEFAULT_POMODORO_PLAN);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(false);

  // 只在「打开的那一刻」灌一次草稿，之后的数据刷新不覆盖用户正在改的东西。
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(stored.map((preset) => ({ ...preset })));
      setPlan({ ...storedPlan });
      setError(null);
    }
    wasOpen.current = open;
  }, [open, stored, storedPlan]);

  const update = (index: number, patch: Partial<DurationPreset>) => {
    setError(null);
    setDraft((prev) => prev.map((preset, i) => (i === index ? { ...preset, ...patch } : preset)));
  };

  const updatePlan = (patch: Partial<PomodoroPlan>) => {
    setError(null);
    setPlan((prev) => ({ ...prev, ...patch }));
  };

  // 批量改过的排期得让所有地方都看见：今天的排期、日历、桌面小组件。
  const refreshSessions = () => {
    qc.invalidateQueries({ queryKey: ["sessions"] });
    qc.invalidateQueries({ queryKey: ["sessions-range"] });
    qc.invalidateQueries({ queryKey: ["sessions-task"] });
    broadcastSessionUpdated();
  };

  const save = async () => {
    for (let index = 0; index < draft.length; index += 1) {
      const preset = draft[index];
      if (preset.label.trim() === "") {
        setError(`第 ${index + 1} 段还没起名字。`);
        return;
      }
      if (!isValidDurationPreset(preset)) {
        setError(`第 ${index + 1} 段的分钟数要在 1 到 1440 之间。`);
        return;
      }
    }

    const changes = diffDurationPresets(stored, draft);
    setBusy(true);
    try {
      // 先改排期，再存设置：排期改失败就别改设置，免得两边对不上。
      const result: PresetDurationShiftResult = changes.length
        ? await api.applyPresetDurationChanges({ changes, fromDate: todayStr() })
        : { matched: 0, updated: 0, conflicts: 0 };
      if (result.updated > 0) refreshSessions();
      try {
        await savePresets(draft);
        await savePlan(plan);
      } catch (e) {
        // 排期已经改了、设置没存上：两边对不上，必须说清楚，不能悄悄关窗。
        setError(`排期已改成功（${result.updated} 场），但设置没存上，请重试：${String(e)}`);
        return;
      }
      onSaved?.(result);
      onClose();
    } catch (e) {
      setError(`保存失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const recommended = buildPomodoroDurations(plan);
  const normalizedPlan = normalizePomodoroPlan(plan);
  // 参数拉太大时排不出那么长的时段，那几段就不生成（生成也存不下来）。
  const truncated = recommended.length < normalizedPlan.roundsBeforeLongBreak + 1;

  return (
    <Modal
      open={open}
      title="常用时长"
      onClose={onClose}
      wide
      footer={
        <>
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-ink-muted hover:bg-white/5"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-lg border border-white/20 bg-surface-3 px-4 py-2 text-ink hover:bg-white/10 disabled:opacity-50"
            onClick={() => void save()}
          >
            保存
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">
        这里改的是全局常用时长：新建排期、改期都会用这一组。
        改了时长之后，今天及以后排在这个旧时长上的场次会一起改到新时长；
        已经完成的历史不动，改过去会撞车的场次保持原样。
      </p>

      <section className="rounded-xl border border-white/10 bg-surface-3/60 p-3">
        <h3 className="text-sm text-ink">番茄钟推荐</h3>
        <p className="mt-1 text-xs text-ink-muted">
          经典节奏：专注 25 分钟 + 短休息 5 分钟，攒够 4 个番茄再来一次 15 分钟长休息。
          下面的时长按「墙钟」算——中间那几分钟的休息，人也是坐在桌前的。
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-xs text-ink-muted">
            专注（分钟）
            <input
              type="number"
              min={1}
              max={180}
              aria-label="番茄钟专注分钟"
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface px-2 py-1 text-sm"
              value={plan.focusMinutes}
              onChange={(event) => updatePlan({ focusMinutes: Number(event.target.value) })}
            />
          </label>
          <label className="text-xs text-ink-muted">
            短休息（分钟）
            <input
              type="number"
              min={0}
              max={60}
              aria-label="番茄钟短休息分钟"
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface px-2 py-1 text-sm"
              value={plan.breakMinutes}
              onChange={(event) => updatePlan({ breakMinutes: Number(event.target.value) })}
            />
          </label>
          <label className="text-xs text-ink-muted">
            长休息（分钟）
            <input
              type="number"
              min={0}
              max={120}
              aria-label="番茄钟长休息分钟"
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface px-2 py-1 text-sm"
              value={plan.longBreakMinutes}
              onChange={(event) => updatePlan({ longBreakMinutes: Number(event.target.value) })}
            />
          </label>
          <label className="text-xs text-ink-muted">
            一轮几个番茄
            <input
              type="number"
              min={1}
              max={12}
              aria-label="番茄钟一轮番茄数"
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface px-2 py-1 text-sm"
              value={plan.roundsBeforeLongBreak}
              onChange={(event) =>
                updatePlan({ roundsBeforeLongBreak: Number(event.target.value) })
              }
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm"
            onClick={() => {
              setError(null);
              setDraft(buildPomodoroDurations(plan));
            }}
          >
            按番茄钟生成
          </button>
          <span className="text-xs text-ink-muted">
            {recommended.map((preset) => formatDurationPresetLabel(preset)).join("、")}
          </span>
        </div>
        {truncated ? (
          <p className="mt-1 text-xs text-amber-200">
            按当前参数只能排到 {recommended.length} 段，更长的超过一天 1440 分钟，没有生成。
          </p>
        ) : null}
      </section>

      <ul className="mt-3 space-y-2">
        {draft.length === 0 ? (
          <li className="text-sm text-ink-muted">
            还没有常用时长，点「添加时长」或「按番茄钟生成」。
          </li>
        ) : null}
        {draft.map((preset, index) => (
          <li key={preset.id} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              aria-label={`第 ${index + 1} 段名称`}
              className="w-24 rounded-lg border border-white/10 bg-surface-3 px-2 py-1 text-sm"
              value={preset.label}
              onChange={(event) => update(index, { label: event.target.value })}
            />
            <input
              type="number"
              min={1}
              max={1440}
              aria-label={`第 ${index + 1} 段分钟`}
              className="w-20 rounded-lg border border-white/10 bg-surface-3 px-2 py-1 text-sm"
              value={preset.minutes || ""}
              onChange={(event) =>
                update(index, { minutes: event.target.value === "" ? 0 : Number(event.target.value) })
              }
            />
            <span className="text-ink-muted">分钟</span>
            <button
              type="button"
              aria-label={`删除第 ${index + 1} 段`}
              className="rounded-lg border border-white/15 px-2 py-1 text-xs"
              onClick={() => {
                setError(null);
                setDraft((prev) => prev.filter((_, i) => i !== index));
              }}
            >
              删除
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-sm"
          onClick={() => {
            setError(null);
            setDraft((prev) => [
              ...prev,
              { id: newDurationPresetId(prev), label: "自定义", minutes: 60 },
            ]);
          }}
        >
          添加时长
        </button>
        <button
          type="button"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-sm"
          onClick={() => {
            setError(null);
            setPlan({ ...DEFAULT_POMODORO_PLAN });
            setDraft(DEFAULT_DURATION_PRESETS.map((preset) => ({ ...preset })));
          }}
        >
          恢复默认
        </button>
      </div>

      {draft.length > 0 ? (
        <p className="mt-3 text-xs text-ink-muted">
          按钮预览：
          {draft.map((preset) => formatDurationPresetLabel(preset)).join("、")}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-amber-200" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
