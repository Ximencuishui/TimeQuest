import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PlanVsActualBarRow } from "./chartHelpers";
import { ChartTooltip } from "./ChartTooltip";

const AXIS_TICK = { fill: "#a1a1aa", fontSize: 12 } as const;
const PLANNED_FILL = "#52525b";

type Props = {
  data: PlanVsActualBarRow[];
};

export function PlanVsActualChart({ data }: Props) {
  return (
    <div className="h-64" data-testid="plan-vs-actual-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={4} barCategoryGap="20%">
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#3f3f46"
            vertical={false}
          />
          <XAxis
            dataKey="subject"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar
            dataKey="planned_min"
            name="计划"
            fill={PLANNED_FILL}
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
          />
          <Bar
            dataKey="actual_min"
            name="实际"
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
          >
            {data.map((row) => (
              <Cell key={row.subject} fill={row.actualFill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: PLANNED_FILL }}
          />
          计划
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-orange-500" />
          实际
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />
          超额
        </span>
      </div>
    </div>
  );
}
