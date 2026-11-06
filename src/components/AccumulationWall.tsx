import { format, parseISO, subDays } from "date-fns";
import { Link } from "react-router-dom";
import { useDailyUnits } from "../hooks/useStats";
import {
  WALL_DAYS,
  WEEKDAY_LABELS,
  brickClass,
  brickLabel,
  placeCells,
  recentWeekIsEmpty,
  todayRingClass,
  wallCells,
  type DayUnits,
} from "../lib/accumulation";
import { todayStr } from "../lib/date";

export function AccumulationWall({
  endDate,
  totals,
}: {
  endDate: string;
  totals: DayUnits[];
}) {
  const cells = wallCells(endDate, totals);
  const { placed, weekCount, monthLabels } = placeCells(cells);
  const showMonths = monthLabels.filter((label) => label).length > 1;
  const quietWeek = recentWeekIsEmpty(cells);
  const rowOffset = showMonths ? 2 : 1;

  return (
    <section aria-label="积累墙">
      <h2 className="font-display text-lg">积累墙</h2>
      <p className="mt-1 text-xs text-ink-muted">
        <span>你的一砖一瓦，正在垒成城堡。</span>
        {quietWeek ? (
          <Link to="/today" className="accumulation-nudge ml-2 text-accent">
            今天还是空的，开始第一课吧！
          </Link>
        ) : null}
      </p>
      <div
        className="mt-3 grid w-fit items-center gap-1"
        style={{
          gridTemplateColumns: `1.75rem repeat(${weekCount}, 0.875rem)`,
          gridTemplateRows: showMonths ? `auto repeat(7, 0.875rem)` : `repeat(7, 0.875rem)`,
        }}
      >
        {showMonths
          ? monthLabels.map((label, col) =>
              label ? (
                <span
                  key={label}
                  className="w-max min-w-0 whitespace-nowrap text-[10px] leading-none text-zinc-500"
                  style={{ gridColumn: col + 2, gridRow: 1 }}
                >
                  {label}
                </span>
              ) : null,
            )
          : null}
        {WEEKDAY_LABELS.map((label, row) =>
          label ? (
            <span
              key={label}
              className="text-[10px] leading-none text-zinc-500"
              style={{ gridColumn: 1, gridRow: row + rowOffset }}
            >
              {label}
            </span>
          ) : null,
        )}
        {placed.map((cell) => {
          const isToday = cell.date === endDate;
          return (
            <div
              key={cell.date}
              className="group relative h-3.5 w-3.5"
              style={{ gridColumn: cell.col + 2, gridRow: cell.row + rowOffset }}
            >
              <div
                data-date={cell.date}
                data-today={isToday ? "true" : undefined}
                title={brickLabel(cell.date, cell.units)}
                aria-label={brickLabel(cell.date, cell.units)}
                className={`h-3.5 w-3.5 rounded-sm ${brickClass(cell.units)} ${
                  isToday ? todayRingClass(cell.units) : "ring-1 ring-white/10"
                }`}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-surface-3 px-2 py-1 text-xs text-ink group-hover:block"
              >
                {brickLabel(cell.date, cell.units)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DashboardAccumulationWall() {
  const today = todayStr();
  const from = format(subDays(parseISO(today), WALL_DAYS - 1), "yyyy-MM-dd");
  const { data } = useDailyUnits(from, today);
  const totals = Array.isArray(data) ? data : [];
  return <AccumulationWall endDate={today} totals={totals} />;
}
