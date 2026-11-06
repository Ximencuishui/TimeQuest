export type ReportRange = "week" | "month";

export type SubjectDuration = {
  subject: string;
  /** Actual study minutes for this subject. */
  minutes: number;
};

export type SubjectComparison = {
  subject: string;
  plannedMinutes: number;
  actualMinutes: number;
};

/** Inputs already shown on the stats page. The function does not read the database. */
export type ReportData = {
  range: ReportRange;
  /** Total study minutes. No positive minutes anywhere yields the empty-record line. */
  totalMinutes: number;
  /** Completed lessons: sum of actual units in the range. */
  totalUnits: number;
  subjects: SubjectDuration[];
  comparisons: SubjectComparison[];
  currentStreak: number;
  longestStreak: number;
};

export const REPORT_CLOSINGS = [
  "接下来的每一页，都算数。",
  "你已经在路上了，慢慢来，比较快。",
  "今天的灯还亮着，就还来得及。",
  "保持这个节奏，城堡会自己长高。",
  "累了就歇口气，书页会等你。",
] as const;

/** Shortfall strictly above this fraction of the plan is called out. 30% itself is not. */
const SHORTFALL_OVER = 0.3;

/** Peak form ("状态拉满") when either hours or lessons clear the bar. */
const PEAK_WEEK_HOURS = 20;
const PEAK_WEEK_UNITS = 25;
const PEAK_MONTH_HOURS = 80;
const PEAK_MONTH_UNITS = 100;

function finiteNonNegative(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

function whole(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.trunc(value);
}

function periodWord(range: ReportRange): string {
  return range === "month" ? "这个月" : "这周";
}

function formatHours(minutes: number): string {
  const rounded = Math.round((minutes / 60) * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1);
}

function formatDuration(minutes: number): string {
  const safe = Math.round(finiteNonNegative(minutes));
  if (safe < 60) return `${safe} 分钟`;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (rest === 0) return `${hours} 小时`;
  return `${hours} 小时 ${rest} 分钟`;
}

function formatPercent(part: number, total: number): string {
  if (total <= 0 || part <= 0) return "0";
  const pct = (part / total) * 100;
  if (pct < 1) return "不到 1";
  return String(Math.round(pct));
}

type Totals = {
  subject: string;
  plannedMinutes: number;
  actualMinutes: number;
};

function durationTotals(rows: SubjectDuration[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.subject.trim() === "") continue;
    const minutes = finiteNonNegative(row.minutes);
    if (minutes <= 0) continue;
    totals.set(row.subject, (totals.get(row.subject) ?? 0) + minutes);
  }
  return totals;
}

function comparisonTotals(rows: SubjectComparison[]): Totals[] {
  const totals = new Map<string, Totals>();
  for (const row of rows) {
    if (row.subject.trim() === "") continue;
    const planned = finiteNonNegative(row.plannedMinutes);
    const actual = finiteNonNegative(row.actualMinutes);
    const prev = totals.get(row.subject);
    if (!prev) {
      totals.set(row.subject, {
        subject: row.subject,
        plannedMinutes: planned,
        actualMinutes: actual,
      });
      continue;
    }
    prev.plannedMinutes += planned;
    prev.actualMinutes += actual;
  }
  return [...totals.values()];
}

function studiedMinutes(data: ReportData, durations: Map<string, number>): number {
  const listed = [...durations.values()].reduce((sum, minutes) => sum + minutes, 0);
  return Math.max(finiteNonNegative(data.totalMinutes), listed);
}

function emptyReport(range: ReportRange): string {
  return `${periodWord(range)}似乎没有留下学习记录。没关系，种一棵树最好的时间是十年前，其次是现在。`;
}

function isPeak(range: ReportRange, minutes: number, units: number): boolean {
  const hours = minutes / 60;
  if (range === "month") {
    return hours >= PEAK_MONTH_HOURS || units >= PEAK_MONTH_UNITS;
  }
  return hours >= PEAK_WEEK_HOURS || units >= PEAK_WEEK_UNITS;
}

function opening(data: ReportData, minutes: number): string {
  const hours = formatHours(minutes);
  const units = whole(data.totalUnits);
  const tone = isPeak(data.range, minutes, units) ? "状态拉满！" : "稳步推进。";
  return `${periodWord(data.range)}你共计投入了 ${hours} 小时，完成了 ${units} 课的学习，${tone}`;
}

function highlights(
  durations: Map<string, number>,
  compared: Totals[],
  totalMinutes: number,
): string | null {
  const lines: string[] = [];
  const entries = [...durations.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"),
  );
  if (entries.length > 0 && totalMinutes > 0) {
    const [subject, minutes] = entries[0];
    lines.push(
      `其中，**${subject}**依然是你最专注的阵地，占了总时长的 ${formatPercent(minutes, totalMinutes)}%。`,
    );
  }

  const rated = compared
    .filter((row) => row.plannedMinutes > 0)
    .sort(
      (a, b) =>
        b.actualMinutes / b.plannedMinutes - a.actualMinutes / a.plannedMinutes ||
        a.subject.localeCompare(b.subject, "zh"),
    );
  if (rated.length > 0) {
    const best = rated[0];
    lines.push(
      `完成率最高的是 **${best.subject}**，达到 ${formatPercent(best.actualMinutes, best.plannedMinutes)}%。`,
    );
  }

  return lines.length > 0 ? lines.join("") : null;
}

function surplus(compared: Totals[]): string | null {
  const rows = compared
    .filter((row) => row.plannedMinutes > 0 && row.actualMinutes > row.plannedMinutes)
    .sort(
      (a, b) =>
        b.actualMinutes -
        b.plannedMinutes -
        (a.actualMinutes - a.plannedMinutes) ||
        a.subject.localeCompare(b.subject, "zh"),
    );
  if (rows.length === 0) return null;
  return rows
    .map(
      (row) =>
        `**${row.subject}**超出了原计划，多投入了 ${formatDuration(row.actualMinutes - row.plannedMinutes)}。`,
    )
    .join("\n\n");
}

function gaps(compared: Totals[]): string | null {
  const rows = compared
    .filter((row) => {
      if (row.plannedMinutes <= 0) return false;
      const shortfall = (row.plannedMinutes - row.actualMinutes) / row.plannedMinutes;
      return shortfall > SHORTFALL_OVER;
    })
    .sort((a, b) => {
      const left = (a.plannedMinutes - a.actualMinutes) / a.plannedMinutes;
      const right = (b.plannedMinutes - b.actualMinutes) / b.plannedMinutes;
      return right - left || a.subject.localeCompare(b.subject, "zh");
    });
  if (rows.length === 0) return null;
  return rows
    .map((row, index) => {
      const lead = index === 0 ? "但要注意，" : "";
      return `${lead}**${row.subject}**排了 ${formatDuration(row.plannedMinutes)}，实际只完成了 ${formatDuration(row.actualMinutes)}，下阶段可能需要适当减少排期或调整时段。`;
    })
    .join("\n\n");
}

function onTrack(compared: Totals[]): string | null {
  if (!compared.some((row) => row.plannedMinutes > 0)) return null;
  return "各科都跟上了计划，没有哪一科掉队超过三成。";
}

function streakLine(current: number, longest: number): string {
  const safeCurrent = whole(current);
  const safeLongest = whole(longest);
  if (safeCurrent > 0) {
    const line = `目前你已连续打卡 ${safeCurrent} 天，千万别让小火苗灭了！`;
    if (safeLongest > safeCurrent) return `${line}最长纪录是 ${safeLongest} 天。`;
    return line;
  }
  const line = "连击断了没关系，今天重新点燃它！";
  if (safeLongest > 0) return `${line}你曾经连续打卡 ${safeLongest} 天。`;
  return line;
}

/** Stable across calls. Same inputs always pick the same closing line. */
function closingFor(data: ReportData, minutes: number): string {
  const seed =
    Math.round(minutes) +
    whole(data.totalUnits) * 17 +
    whole(data.currentStreak) * 31 +
    whole(data.longestStreak) * 13 +
    (data.range === "month" ? 7 : 0);
  return REPORT_CLOSINGS[seed % REPORT_CLOSINGS.length];
}

export function generateLearningReport(data: ReportData): string {
  const durations = durationTotals(data.subjects);
  const minutes = studiedMinutes(data, durations);
  if (minutes <= 0) return emptyReport(data.range);

  const compared = comparisonTotals(data.comparisons);
  const extra = surplus(compared);
  const gap = gaps(compared);
  const sections = [
    opening(data, minutes),
    highlights(durations, compared, minutes),
    extra,
    gap ?? (extra ? null : onTrack(compared)),
    streakLine(data.currentStreak, data.longestStreak),
    closingFor(data, minutes),
  ].filter((section): section is string => section != null && section !== "");

  return sections.join("\n\n");
}
