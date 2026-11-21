import { useState } from "react";
import { useDurationPresets } from "../hooks/useDurationPresets";
import { useTimePresets } from "../hooks/useTimePresets";
import { addMinutesToHhmm } from "../lib/timeField";
import { formatDurationPresetLabel } from "../lib/durationPresets";
import { formatTimePresetLabel } from "../lib/timePresets";
import type { PresetDurationShiftResult, PresetShiftResult } from "../types";
import { DurationPresetEditor } from "./DurationPresetEditor";
import { TimeField } from "./TimeField";
import { TimePresetEditor } from "./TimePresetEditor";

type Props = {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
};

/**
 * 开始 / 结束 + 常用时段快捷 + 常用时长快捷。
 *
 * 学生最常见的排期是「某一天的某个整块时间」，所以把常用时段直接做成按钮：
 * 点一下就把开始和结束一起设好，不用去掰原生时间控件。
 *
 * 常用时段、常用时长都是全局设置：点标题右边的齿轮可以自己编辑，
 * 改完保存后所有地方的快捷按钮一起变，已排的场次也会跟着挪到新时段 / 新时长。
 */
export function TimeRangeField({ start, end, onChange }: Props) {
  const { presets } = useTimePresets();
  const { presets: durations } = useDurationPresets();
  const [editorOpen, setEditorOpen] = useState(false);
  const [durationEditorOpen, setDurationEditorOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [durationSummary, setDurationSummary] = useState<string | null>(null);

  const onSaved = (result: PresetShiftResult) => {
    if (result.updated > 0) {
      setSummary(
        `已保存，${result.updated} 场排期已挪到新的常用时段${
          result.conflicts > 0 ? `；${result.conflicts} 场撞车保持原样` : ""
        }。`,
      );
      return;
    }
    if (result.conflicts > 0) {
      setSummary(`已保存；${result.conflicts} 场排期挪过去会撞车，保持原样。`);
      return;
    }
    setSummary("已保存。");
  };

  const onDurationSaved = (result: PresetDurationShiftResult) => {
    if (result.updated > 0) {
      setDurationSummary(
        `已保存，${result.updated} 场排期已改成新的常用时长${
          result.conflicts > 0 ? `；${result.conflicts} 场撞车保持原样` : ""
        }。`,
      );
      return;
    }
    if (result.conflicts > 0) {
      setDurationSummary(`已保存；${result.conflicts} 场排期改过去会撞车，保持原样。`);
      return;
    }
    setDurationSummary("已保存。");
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-ink-muted">开始</span>
          <TimeField
            label="开始"
            value={start}
            onChange={(value) => onChange(value, end)}
          />
        </div>
        <div>
          <span className="text-ink-muted">结束</span>
          <TimeField
            label="结束"
            value={end}
            onChange={(value) => onChange(start, value)}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1.5">
          <span className="text-ink-muted">常用时段</span>
          <button
            type="button"
            aria-label="编辑常用时段"
            title="编辑常用时段"
            className="rounded-lg px-1.5 py-0.5 text-sm text-ink-muted hover:bg-white/5 hover:text-ink"
            onClick={() => setEditorOpen(true)}
          >
            ⚙
          </button>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange(preset.start, preset.end)}
              className={`rounded-lg border px-2 py-1 text-xs ${
                start === preset.start && end === preset.end
                  ? "border-accent bg-accent/20 text-ink"
                  : "border-white/10 bg-surface-3 text-ink-muted hover:bg-white/5 hover:text-ink"
              }`}
            >
              {formatTimePresetLabel(preset)}
            </button>
          ))}
        </div>
        {summary ? (
          <p className="mt-1 text-xs text-ink-muted">{summary}</p>
        ) : null}
      </div>

      <div>
        <div className="flex items-center gap-1.5">
          <span className="text-ink-muted">时长</span>
          <button
            type="button"
            aria-label="编辑常用时长"
            title="编辑常用时长"
            className="rounded-lg px-1.5 py-0.5 text-sm text-ink-muted hover:bg-white/5 hover:text-ink"
            onClick={() => setDurationEditorOpen(true)}
          >
            ⚙
          </button>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {durations.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange(start, addMinutesToHhmm(start, preset.minutes))}
              className={`rounded-lg border px-2 py-1 text-xs ${
                end === addMinutesToHhmm(start, preset.minutes)
                  ? "border-accent bg-accent/20 text-ink"
                  : "border-white/10 bg-surface-3 text-ink-muted hover:bg-white/5 hover:text-ink"
              }`}
            >
              {formatDurationPresetLabel(preset)}
            </button>
          ))}
        </div>
        {durationSummary ? (
          <p className="mt-1 text-xs text-ink-muted">{durationSummary}</p>
        ) : null}
      </div>

      <TimePresetEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={onSaved}
      />

      <DurationPresetEditor
        open={durationEditorOpen}
        onClose={() => setDurationEditorOpen(false)}
        onSaved={onDurationSaved}
      />
    </div>
  );
}