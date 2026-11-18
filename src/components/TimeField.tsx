import { useState } from "react";
import {
  HOUR_CHOICES,
  MINUTE_CHOICES,
  formatHhmm,
  parseHhmm,
} from "../lib/timeField";

type Props = {
  /** 无障碍名称，同时也是原生精确输入的 label。 */
  label: string;
  value: string;
  onChange: (value: string) => void;
};

/**
 * 自绘时间选择：主交互是小时/分钟网格，精确到分用面板里的原生输入兜底。
 *
 * 视觉上不用原生时间控件（学生嫌它难用），但仍保留一个隐藏的原生输入，
 * 承载真实的表单值与无障碍语义。
 */
export function TimeField({ label, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const parsed = parseHhmm(value);
  const hour = parsed?.hour ?? 0;
  const minute = parsed?.minute ?? 0;

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-label={`${label}：${value}`}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-left text-ink hover:bg-white/5"
        >
          <span className="tabular-nums">{value}</span>
          <span aria-hidden="true" className="text-ink-muted">
            ▾
          </span>
        </button>
        <input
          type="time"
          aria-label={label}
          tabIndex={-1}
          className="sr-only"
          value={value}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value);
          }}
        />
      </div>

      {open ? (
        <div
          role="group"
          aria-label={`${label}快捷`}
          className="absolute z-30 mt-1 w-64 rounded-xl border border-white/10 bg-surface-3 p-3 shadow-2xl"
        >
          <p className="mb-2 text-xs text-ink-muted">点小时，再点分钟</p>
          <div className="grid grid-cols-6 gap-1">
            {HOUR_CHOICES.map((h) => (
              <button
                key={h}
                type="button"
                aria-label={`${label} ${String(h).padStart(2, "0")} 点`}
                aria-pressed={h === hour}
                onClick={() => onChange(formatHhmm(h, minute))}
                className={`rounded-lg px-1 py-1.5 text-sm tabular-nums ${
                  h === hour
                    ? "bg-accent text-white"
                    : "bg-surface-2 text-ink hover:bg-white/10"
                }`}
              >
                {String(h).padStart(2, "0")}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {MINUTE_CHOICES.map((m) => (
              <button
                key={m}
                type="button"
                aria-label={`${label} ${String(m).padStart(2, "0")} 分`}
                aria-pressed={m === minute}
                onClick={() => {
                  onChange(formatHhmm(hour, m));
                  setOpen(false);
                }}
                className={`rounded-lg px-1 py-1.5 text-sm tabular-nums ${
                  m === minute
                    ? "bg-accent text-white"
                    : "bg-surface-2 text-ink hover:bg-white/10"
                }`}
              >
                :{String(m).padStart(2, "0")}
              </button>
            ))}
          </div>
          <label className="mt-3 block text-xs text-ink-muted">
            精确到分
            <input
              type="time"
              aria-label={`${label}（精确到分）`}
              value={value}
              onChange={(e) => {
                if (e.target.value) onChange(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-2 px-2 py-1.5 text-sm text-ink"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
