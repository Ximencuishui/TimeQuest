import { useEffect, useState } from "react";
import { WEEKDAY_LABELS } from "../lib/calendar";
import { todayStr } from "../lib/date";
import {
  addDaysIso,
  monthGridIso,
  monthKey,
  monthLabelZh,
  nextMondayIso,
  relativeDayLabel,
  shiftMonthIso,
  shortDateLabel,
  weekdayLabel,
} from "../lib/dateField";

type Props = {
  /** 无障碍名称，同时也是原生日期输入的 label。 */
  label: string;
  /** `YYYY-MM-DD`；空字符串表示「未选择」。 */
  value: string;
  onChange: (value: string) => void;
  /** 覆盖「今天」，测试与回放用。 */
  today?: string;
  /** 允许清空（用于「可以不绑定日期」的场景）。 */
  allowEmpty?: boolean;
  /** 未选择时按钮上的文案。 */
  emptyLabel?: string;
};

/**
 * 自绘日期选择：今天/明天/后天/下周一 快捷 + 月历网格。
 *
 * 视觉上不用原生日期控件（学生嫌它难用），但仍保留一个隐藏的原生输入，
 * 承载真实的表单值与无障碍语义。
 */
export function DateField({
  label,
  value,
  onChange,
  today,
  allowEmpty = false,
  emptyLabel = "未选择",
}: Props) {
  const [open, setOpen] = useState(false);
  const todayIso = today ?? todayStr();
  // 未绑定时月历从「今天」所在的月份开始，而不是空白月份。
  const [month, setMonth] = useState(() => monthKey(value || todayIso));

  useEffect(() => {
    setMonth(monthKey(value || todayIso));
  }, [value, todayIso]);

  const relative = value ? relativeDayLabel(value, todayIso) : null;
  const display = !value
    ? emptyLabel
    : relative
      ? `${relative} · ${shortDateLabel(value)}`
      : `${shortDateLabel(value)} ${weekdayLabel(value)}`;

  const grid = monthGridIso(month);
  const monthNumber = Number(month.slice(5, 7));

  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-label={`${label}：${display}`}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-left text-ink hover:bg-white/5"
        >
          <span>{display}</span>
          <span aria-hidden="true" className="text-ink-muted">
            ▾
          </span>
        </button>
        <input
          type="date"
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
          className="absolute z-30 mt-1 w-72 rounded-xl border border-white/10 bg-surface-3 p-3 shadow-2xl"
        >
          <div className="mb-2 flex flex-wrap gap-1.5">
            {allowEmpty ? (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="rounded-lg border border-white/10 bg-surface-2 px-2 py-1 text-xs text-ink-muted hover:bg-white/5 hover:text-ink"
              >
                {emptyLabel}
              </button>
            ) : null}
            {[
              { text: "今天", iso: todayIso },
              { text: "明天", iso: addDaysIso(todayIso, 1) },
              { text: "后天", iso: addDaysIso(todayIso, 2) },
              { text: "下周一", iso: nextMondayIso(todayIso) },
            ].map((item) => (
              <button
                key={item.text}
                type="button"
                onClick={() => pick(item.iso)}
                className={`rounded-lg border px-2 py-1 text-xs ${
                  value === item.iso
                    ? "border-accent bg-accent/20 text-ink"
                    : "border-white/10 bg-surface-2 text-ink-muted hover:bg-white/5 hover:text-ink"
                }`}
              >
                {item.text}
              </button>
            ))}
          </div>

          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              aria-label="上个月"
              onClick={() => setMonth((prev) => shiftMonthIso(prev, -1))}
              className="rounded-lg border border-white/10 bg-surface-2 px-2 py-1 text-sm text-ink hover:bg-white/5"
            >
              ‹
            </button>
            <span className="text-sm text-ink">{monthLabelZh(month)}</span>
            <button
              type="button"
              aria-label="下个月"
              onClick={() => setMonth((prev) => shiftMonthIso(prev, 1))}
              className="rounded-lg border border-white/10 bg-surface-2 px-2 py-1 text-sm text-ink hover:bg-white/5"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="text-center text-xs text-ink-muted">
                {label}
              </div>
            ))}
            {grid.map((iso) => {
              const inMonth = Number(iso.slice(5, 7)) === monthNumber;
              const isToday = iso === todayIso;
              return (
                <button
                  key={iso}
                  type="button"
                  data-testid={`date-field-day-${iso}`}
                  aria-label={`${shortDateLabel(iso)} ${weekdayLabel(iso)}`}
                  aria-pressed={iso === value}
                  onClick={() => pick(iso)}
                  className={[
                    "rounded-lg px-1 py-1.5 text-xs tabular-nums",
                    inMonth ? "text-ink" : "text-zinc-500",
                    iso === value ? "bg-accent text-white" : "bg-surface-2 hover:bg-white/10",
                    isToday && iso !== value ? "ring-1 ring-accent" : "",
                  ].join(" ")}
                >
                  {Number(iso.slice(8, 10))}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
