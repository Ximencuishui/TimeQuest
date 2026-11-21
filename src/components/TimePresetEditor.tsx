import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/tauri";
import { useTimePresets } from "../hooks/useTimePresets";
import { todayStr } from "../lib/date";
import { formatHhmm } from "../lib/timeField";
import { broadcastSessionUpdated } from "../lib/widgetWindow";
import {
  DEFAULT_TIME_PRESETS,
  diffTimePresets,
  formatTimePresetLabel,
  isValidTimePreset,
  newTimePresetId,
  type TimePreset,
} from "../lib/timePresets";
import type { PresetShiftResult } from "../types";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  onClose: () => void;
  /** 保存后回报：计划被同步了多少场。 */
  onSaved?: (result: PresetShiftResult) => void;
};

/** 找一个还没被占用的整点时段，给「添加时段」用。 */
function nextFreeSlot(presets: TimePreset[]): { start: string; end: string } {
  const taken = new Set(presets.map((preset) => `${preset.start}-${preset.end}`));
  for (let hour = 7; hour <= 21; hour += 1) {
    const start = formatHhmm(hour, 0);
    const end = formatHhmm(hour + 1, 0);
    if (!taken.has(`${start}-${end}`)) return { start, end };
  }
  return { start: "09:00", end: "10:00" };
}

/**
 * 常用时段编辑器。
 *
 * 学生自己定一套常用时间（早读、上午、晚自习……），保存后全局生效：
 * 新建排期、改期都用同一套。
 *
 * 保存时会把「改了时间的旧时段」交给后端批量挪动：
 * 今天及以后排在这个旧时段上的场次一起挪到新时段，
 * 已经完成的历史不动，挪过去会撞车的保持原样。
 */
export function TimePresetEditor({ open, onClose, onSaved }: Props) {
  const { presets: stored, savePresets } = useTimePresets();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<TimePreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(false);

  // 只在「打开的那一刻」灌一次草稿，之后的数据刷新不覆盖用户正在改的东西。
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(stored.map((preset) => ({ ...preset })));
      setError(null);
    }
    wasOpen.current = open;
  }, [open, stored]);

  const update = (index: number, patch: Partial<TimePreset>) => {
    setError(null);
    setDraft((prev) => prev.map((preset, i) => (i === index ? { ...preset, ...patch } : preset)));
  };

  // 批量挪过的排期得让所有地方都看见：今天的排期、日历、桌面小组件。
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
      if (!isValidTimePreset(preset)) {
        setError(`第 ${index + 1} 段的结束时间要晚于开始时间。`);
        return;
      }
    }

    const changes = diffTimePresets(stored, draft);
    setBusy(true);
    try {
      // 先挪排期，再存设置：排期挪失败就别改设置，免得两边对不上。
      const result: PresetShiftResult = changes.length
        ? await api.applyPresetTimeChanges({ changes, fromDate: todayStr() })
        : { matched: 0, updated: 0, conflicts: 0 };
      if (result.updated > 0) refreshSessions();
      try {
        await savePresets(draft);
      } catch (e) {
        // 排期已经挪了、设置没存上：两边对不上，必须说清楚，不能悄悄关窗。
        setError(`排期已挪成功（${result.updated} 场），但设置没存上，请重试：${String(e)}`);
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

  return (
    <Modal
      open={open}
      title="常用时段"
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
        这里改的是全局常用时段：新建排期、改期都会用这一套。
        改了时间之后，今天及以后排在这个旧时段上的场次会一起挪到新时段；
        已经完成的历史不动，挪过去会撞车的场次保持原样。
      </p>

      <ul className="space-y-2">
        {draft.length === 0 ? (
          <li className="text-sm text-ink-muted">
            还没有常用时段，点「添加时段」或「恢复默认」。
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
              type="time"
              aria-label={`第 ${index + 1} 段开始时间`}
              className="rounded-lg border border-white/10 bg-surface-3 px-2 py-1 text-sm"
              value={preset.start}
              onChange={(event) => update(index, { start: event.target.value })}
            />
            <span className="text-ink-muted">–</span>
            <input
              type="time"
              aria-label={`第 ${index + 1} 段结束时间`}
              className="rounded-lg border border-white/10 bg-surface-3 px-2 py-1 text-sm"
              value={preset.end}
              onChange={(event) => update(index, { end: event.target.value })}
            />
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
            const slot = nextFreeSlot(draft);
            setDraft((prev) => [
              ...prev,
              { id: newTimePresetId(prev), label: "自定义", ...slot },
            ]);
          }}
        >
          添加时段
        </button>
        <button
          type="button"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-sm"
          onClick={() => {
            setError(null);
            setDraft(DEFAULT_TIME_PRESETS.map((preset) => ({ ...preset })));
          }}
        >
          恢复默认
        </button>
      </div>

      {draft.length > 0 ? (
        <p className="mt-3 text-xs text-ink-muted">
          按钮预览：
          {draft.map((preset) => formatTimePresetLabel(preset)).join("、")}
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