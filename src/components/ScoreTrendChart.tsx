import { useState } from "react";
import {
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EXAM_SCORE_FIELDS } from "../lib/examRecord";
import {
  buildTrendChart,
  buildTrendPoints,
  formatScoreGap,
  scoresAttribute,
  targetForSubject,
  trendDomain,
  type ScoreTargets,
  type ScoreTrendSubject,
  type TrendChartRow,
} from "../lib/scoreTrend";
import type { ExamRecord } from "../types";

const ABOVE = "#4ade80";
const BELOW = "#f97316";
const PLAIN = "#d4d4d8";
const AXIS_TICK = { fill: "#a1a1aa", fontSize: 12 } as const;

const TABS: { id: ScoreTrendSubject; label: string }[] = [
  { id: "total", label: "总分" },
  ...EXAM_SCORE_FIELDS.map((field) => ({ id: field.subject, label: field.label })),
];

type DotProps = {
  cx?: number;
  cy?: number;
  payload?: TrendChartRow;
};

function axisTick(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[2]}-${match[3]}`;
}

function pointFill(score: number, target: number | null): string {
  if (target == null) return PLAIN;
  return score >= target ? ABOVE : BELOW;
}

function ScoreDot({ cx, cy, payload }: DotProps) {
  if (cx == null || cy == null || payload?.score == null) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={payload.latest ? 6 : 4}
      fill={pointFill(payload.score, payload.target)}
      stroke="#09090b"
      strokeWidth={1.5}
    />
  );
}

function ScoreActiveDot({ cx, cy, payload }: DotProps) {
  if (cx == null || cy == null || payload?.score == null) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={8}
      fill={pointFill(payload.score, payload.target)}
      stroke="#fafafa"
      strokeWidth={2}
    />
  );
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TrendChartRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row || row.score == null) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white shadow-lg shadow-black/40">
      <div className="text-xs text-zinc-400">{row.examName}</div>
      <div className="text-xs text-zinc-500">{row.examDate}</div>
      <div className="mt-1">本次 {row.score} 分</div>
      <div>
        {row.target == null ? "还没有目标分" : `与目标 ${formatScoreGap(row.score, row.target)}`}
      </div>
    </div>
  );
}

export function ScoreTrendChart({
  records,
  targets,
}: {
  records: ExamRecord[];
  targets: ScoreTargets;
}) {
  const [subject, setSubject] = useState<ScoreTrendSubject>("total");
  const points = buildTrendPoints(records, subject, targets);
  const { rows, segments } = buildTrendChart(points);
  const target = points[0]?.target ?? targetForSubject(targets, subject);
  const domain = trendDomain(points);
  const plotted = points.filter((point) => point.score != null).length;
  const tabLabel = TABS.find((tab) => tab.id === subject)?.label ?? "总分";
  const caption =
    subject === "total"
      ? target == null
        ? "还没有总分目标，先不画虚线。六科都有分才计入总分。"
        : "虚线是当前高考总目标。六科都有分才计入总分。"
      : target == null
        ? `还没有${tabLabel}目标，先不画虚线。`
        : `虚线是当前${tabLabel}目标。`;

  return (
    <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg">与目标的距离</h2>
          <p className="mt-1 text-xs text-ink-muted">{caption}</p>
        </div>
      </div>
      <div role="tablist" aria-label="成绩科目" className="mt-3 flex gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const selected = tab.id === subject;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${
                selected
                  ? "bg-accent/15 text-accent-soft"
                  : "text-ink-muted hover:bg-white/5 hover:text-ink"
              }`}
              onClick={() => setSubject(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        className="mt-3 h-72"
        data-testid="score-trend-chart"
        data-scores={scoresAttribute(points)}
        data-domain={`${domain[0]},${domain[1]}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 24, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={axisTick}
            />
            <YAxis
              domain={domain}
              allowDecimals={false}
              padding={{ top: 12, bottom: 12 }}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip content={<TrendTooltip />} />
            {target != null ? (
              <ReferenceLine
                y={target}
                stroke="#a1a1aa"
                strokeDasharray="5 5"
                ifOverflow="extendDomain"
                label={{
                  value: `目标 ${target}`,
                  position: "insideTopRight",
                  fill: "#a1a1aa",
                  fontSize: 12,
                }}
              />
            ) : null}
            {segments.map((segment) => (
              <Line
                key={segment.key}
                type="monotone"
                dataKey={segment.key}
                stroke={segment.tone === "above" ? ABOVE : segment.tone === "below" ? BELOW : PLAIN}
                strokeWidth={2.5}
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
                legendType="none"
              />
            ))}
            <Line
              type="monotone"
              dataKey="score"
              stroke="transparent"
              strokeWidth={0}
              dot={<ScoreDot />}
              activeDot={<ScoreActiveDot />}
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
            >
              <LabelList
                dataKey="score"
                position="top"
                fill="#e4e4e7"
                fontSize={11}
                formatter={(value) => (typeof value === "number" ? String(value) : "")}
              />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </div>
      {plotted === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">这几场没有{tabLabel}成绩。</p>
      ) : null}
    </section>
  );
}
