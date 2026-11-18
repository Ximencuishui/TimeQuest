import { TimeField } from "./TimeField";
import {
  DURATION_PRESETS,
  TIME_PRESETS,
  addMinutesToHhmm,
  formatDurationLabel,
} from "../lib/timeField";

type Props = {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
};

/**
 * 开始 / 结束 + 常用时段快捷。
 *
 * 学生最常见的排期是「某一天的某个整块时间」，所以把常用时段直接做成按钮：
 * 点一下就把开始和结束一起设好，不用去掰原生时间控件。
 */
export function TimeRangeField({ start, end, onChange }: Props) {
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
        <span className="text-ink-muted">常用时段</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {TIME_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.start, preset.end)}
              className={`rounded-lg border px-2 py-1 text-xs ${
                start === preset.start && end === preset.end
                  ? "border-accent bg-accent/20 text-ink"
                  : "border-white/10 bg-surface-3 text-ink-muted hover:bg-white/5 hover:text-ink"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="text-ink-muted">时长</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {DURATION_PRESETS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => onChange(start, addMinutesToHhmm(start, minutes))}
              className="rounded-lg border border-white/10 bg-surface-3 px-2 py-1 text-xs text-ink-muted hover:bg-white/5 hover:text-ink"
            >
              {formatDurationLabel(minutes)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
