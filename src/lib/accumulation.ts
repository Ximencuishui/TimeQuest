import { differenceInCalendarDays, format, parseISO, startOfWeek, subDays } from "date-fns";

export const WALL_DAYS = 28;

export type DayUnits = {
  date: string;
  units: number;
};

/** Brick color for one day's completed units. */
export function brickClass(units: number): string {
  if (units <= 0) return "bg-zinc-800";
  if (units <= 3) return "bg-orange-900";
  if (units <= 6) return "bg-orange-600";
  return "bg-orange-400";
}

export function brickLabel(date: string, units: number): string {
  return `${date} · 完成 ${units}`;
}

/** Monday-first row labels. Only Mon / Wed / Fri are shown. */
export const WEEKDAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""] as const;

export function todayRingClass(units: number): string {
  return units > 0 ? "ring-1 ring-orange-500" : "ring-1 ring-zinc-500";
}

/** The newest 7 local days are all 0, including days with no row. */
export function recentWeekIsEmpty(cells: DayUnits[]): boolean {
  return cells.slice(-7).every((cell) => cell.units <= 0);
}

export type PlacedCell = DayUnits & { row: number; col: number };

/**
 * Place the 28 days on a Monday-first week grid.
 * `row` 0 is Monday. Leading and trailing days outside the window are omitted.
 */
export function placeCells(cells: DayUnits[]): {
  placed: PlacedCell[];
  weekCount: number;
  monthLabels: (string | null)[];
} {
  const origin = startOfWeek(parseISO(cells[0].date), { weekStartsOn: 1 });
  const last = parseISO(cells[cells.length - 1].date);
  const weekCount =
    Math.floor(
      differenceInCalendarDays(startOfWeek(last, { weekStartsOn: 1 }), origin) / 7,
    ) + 1;
  const monthLabels: (string | null)[] = Array.from({ length: weekCount }, () => null);
  const seen = new Set<string>();
  const placed = cells.map((cell) => {
    const offset = differenceInCalendarDays(parseISO(cell.date), origin);
    const monthKey = cell.date.slice(0, 7);
    if (!seen.has(monthKey)) {
      seen.add(monthKey);
      monthLabels[Math.floor(offset / 7)] = `${Number(cell.date.slice(5, 7))}月`;
    }
    return { ...cell, row: offset % 7, col: Math.floor(offset / 7) };
  });
  return { placed, weekCount, monthLabels };
}

/**
 * 28 local days ending at `endDate`, oldest first.
 * Days missing from `totals` are 0. Layout is 7 columns × 4 rows.
 */
export function wallCells(endDate: string, totals: DayUnits[]): DayUnits[] {
  const byDate = new Map(totals.map((row) => [row.date, row.units]));
  const end = parseISO(endDate);
  const cells: DayUnits[] = [];
  for (let offset = WALL_DAYS - 1; offset >= 0; offset -= 1) {
    const date = format(subDays(end, offset), "yyyy-MM-dd");
    cells.push({ date, units: byDate.get(date) ?? 0 });
  }
  return cells;
}
