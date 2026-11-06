import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  donutTotalMinutes,
  formatStudyHours,
  type DonutSlice,
} from "./chartHelpers";
import { ChartTooltip } from "./ChartTooltip";

type Props = {
  slices: DonutSlice[];
  /** Center caption prefix, e.g. 总学习时长 */
  centerLabel?: string;
  /** data-testid on the chart shell */
  testId: string;
  /** Legend list aria-label */
  legendLabel: string;
  /**
   * `name-min` → `刷题 · 40 分` (method share tests).
   * `name-min-pct` → `数学 · 45 分 · 100%` (subject share).
   */
  legendFormat?: "name-min-pct" | "name-min";
};

export function DonutChart({
  slices,
  centerLabel = "总学习时长",
  testId,
  legendLabel,
  legendFormat = "name-min-pct",
}: Props) {
  const hours = formatStudyHours(donutTotalMinutes(slices));

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative mx-auto h-56 w-full max-w-[280px] shrink-0 sm:mx-0">
        <div className="h-full w-full" data-testid={testId}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                innerRadius="60%"
                outerRadius="80%"
                paddingAngle={slices.length > 1 ? 2 : 0}
                stroke="none"
              >
                {slices.map((slice) => (
                  <Cell key={slice.name} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          aria-hidden
        >
          <span className="text-[11px] text-zinc-500">{centerLabel}</span>
          <span className="font-display text-base tabular-nums text-ink">
            {hours} 小时
          </span>
        </div>
        <span className="sr-only">
          {centerLabel}：{hours} 小时
        </span>
      </div>

      <ul
        className="min-w-0 flex-1 space-y-2 text-sm"
        aria-label={legendLabel}
      >
        {slices.map((slice) => {
          const pct = `${Math.round(slice.percent)}%`;
          const line =
            legendFormat === "name-min"
              ? `${slice.name} · ${slice.value} 分`
              : `${slice.name} · ${slice.value} 分 · ${pct}`;
          return (
            <li key={slice.name} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: slice.color }}
              />
              <span className="min-w-0 truncate text-ink-muted">{line}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
