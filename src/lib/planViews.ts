import { differenceInCalendarDays } from "date-fns";
import { parseLocalDate } from "./calendar";
import type { Task, TaskSession } from "../types";

/**
 * 总计划页的筛选状态。
 *
 * 三个维度各自是「多选」，维度之间是「与」：同一个维度里选多个标签是「或」，
 * 跨维度组合是「且」。这样一个标签能看全计划，组合起来能定位到具体那本教材的某一轮。
 */
export type PlanFilter = {
  subjects: string[];
  textbooks: string[];
  rounds: number[];
};

export type PlanTags = {
  subjects: string[];
  textbooks: string[];
  rounds: number[];
};

export function emptyPlanFilter(): PlanFilter {
  return { subjects: [], textbooks: [], rounds: [] };
}

export function isPlanFilterActive(filter: PlanFilter): boolean {
  return (
    filter.subjects.length > 0 ||
    filter.textbooks.length > 0 ||
    filter.rounds.length > 0
  );
}

/** 多选标签的互斥切换：再点一次就取消。 */
export function toggleFilterValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * 标签来自任务本身：学科、课本取任务字段；
 * 轮次取「任务总轮次」和「排期里出现过的最大轮次」里的最大值。
 */
export function collectPlanTags(
  tasks: Task[],
  sessions: TaskSession[] = [],
): PlanTags {
  const subjects = new Set<string>();
  const textbooks = new Set<string>();
  const maxRoundByTask = new Map<number, number>();
  let maxRound = 0;

  for (const session of sessions) {
    const prev = maxRoundByTask.get(session.task_id) ?? 0;
    if (session.round > prev) maxRoundByTask.set(session.task_id, session.round);
  }

  for (const task of tasks) {
    if (task.subject) subjects.add(task.subject);
    if (task.textbook) textbooks.add(task.textbook);
    maxRound = Math.max(
      maxRound,
      task.total_rounds ?? 0,
      maxRoundByTask.get(task.id) ?? 0,
    );
  }

  return {
    subjects: [...subjects].sort((a, b) => a.localeCompare(b)),
    textbooks: [...textbooks].sort((a, b) => a.localeCompare(b)),
    rounds: Array.from({ length: maxRound }, (_, index) => index + 1),
  };
}

/**
 * 轮次匹配：任务在这一轮有排期，或者它当前正走到这一轮。
 *
 * 只看 current_round 会漏掉「第一轮已经排完、第二轮还没开始」的空档期，
 * 所以排期里的轮次也算数。
 */
export function taskMatchesRound(
  task: Task,
  round: number,
  sessions: TaskSession[],
): boolean {
  if (task.current_round === round) return true;
  return sessions.some(
    (session) => session.task_id === task.id && session.round === round,
  );
}

/** 按筛选条件过滤任务。同一维度内是「或」，跨维度是「且」。 */
export function filterPlanTasks(
  tasks: Task[],
  sessions: TaskSession[],
  filter: PlanFilter,
): Task[] {
  return tasks.filter((task) => {
    if (filter.subjects.length > 0) {
      if (!task.subject || !filter.subjects.includes(task.subject)) return false;
    }
    if (filter.textbooks.length > 0) {
      if (!task.textbook || !filter.textbooks.includes(task.textbook)) return false;
    }
    if (filter.rounds.length > 0) {
      const hit = filter.rounds.some((round) =>
        taskMatchesRound(task, round, sessions),
      );
      if (!hit) return false;
    }
    return true;
  });
}

/** 只留下属于这些任务的排期。 */
export function sessionsOfTasks(
  sessions: TaskSession[],
  tasks: Task[],
): TaskSession[] {
  const ids = new Set(tasks.map((task) => task.id));
  return sessions.filter((session) => ids.has(session.task_id));
}

export type GanttSegment = {
  /** `YYYY-MM-DD`。 */
  start: string;
  end: string;
  /** 这一段跨了多少天（含首尾）。 */
  days: number;
  plannedUnits: number;
  doneUnits: number;
  missed: number;
  status: "done" | "planned" | "missed";
};

function segmentOf(
  start: string,
  end: string,
  sessions: TaskSession[],
): GanttSegment {
  const doneUnits = sessions
    .filter((session) => session.status === "done")
    .reduce((sum, session) => sum + (session.actual_units ?? 0), 0);
  const plannedUnits = sessions.reduce(
    (sum, session) => sum + (session.planned_units ?? 0),
    0,
  );
  const missed = sessions.filter((session) => session.status === "missed").length;
  const allDone = sessions.every((session) => session.status === "done");
  const allMissed = sessions.every((session) => session.status === "missed");
  const status: GanttSegment["status"] = allDone
    ? "done"
    : allMissed
      ? "missed"
      : "planned";
  const days =
    differenceInCalendarDays(parseLocalDate(end), parseLocalDate(start)) + 1;
  return { start, end, days, plannedUnits, doneUnits, missed, status };
}

/**
 * 把排期压成甘特图上的连续条：同一天的多场合并成一天，
 * 相邻两天再合并成一段，中间断掉就断开。
 */
export function buildGanttSegments(sessions: TaskSession[]): GanttSegment[] {
  const byDate = new Map<string, TaskSession[]>();
  for (const session of sessions) {
    const list = byDate.get(session.date) ?? [];
    list.push(session);
    byDate.set(session.date, list);
  }
  const dates = [...byDate.keys()].sort();
  const segments: GanttSegment[] = [];

  let currentStart: string | null = null;
  let currentEnd: string | null = null;
  let currentSessions: TaskSession[] = [];

  const flush = () => {
    if (currentStart && currentEnd) {
      segments.push(segmentOf(currentStart, currentEnd, currentSessions));
    }
  };

  for (const date of dates) {
    const daySessions = byDate.get(date) ?? [];
    if (currentEnd && differenceInCalendarDays(parseLocalDate(date), parseLocalDate(currentEnd)) === 1) {
      currentEnd = date;
      currentSessions.push(...daySessions);
      continue;
    }
    flush();
    currentStart = date;
    currentEnd = date;
    currentSessions = [...daySessions];
  }
  flush();

  return segments;
}

export type GanttBounds = {
  start: string;
  end: string;
  totalDays: number;
};

function shiftIsoDate(iso: string, deltaDays: number): string {
  const date = parseLocalDate(iso);
  if (Number.isNaN(date.getTime())) return iso;
  date.setDate(date.getDate() + deltaDays);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 甘特图横轴的范围：至少覆盖今天前后各一段。 */
export function computeGanttBounds(
  sessions: TaskSession[],
  today: string,
): GanttBounds {
  let min = today;
  let max = today;
  for (const session of sessions) {
    if (session.date < min) min = session.date;
    if (session.date > max) max = session.date;
  }
  const start = shiftIsoDate(min, -3);
  const end = shiftIsoDate(max, 3);
  const totalDays =
    differenceInCalendarDays(parseLocalDate(end), parseLocalDate(start)) + 1;
  return { start, end, totalDays: Math.max(1, totalDays) };
}

/** 日期在甘特横轴上的位置比例（0..1）。 */
export function ganttRatio(
  date: string,
  bounds: GanttBounds,
): number {
  const offset = differenceInCalendarDays(
    parseLocalDate(date),
    parseLocalDate(bounds.start),
  );
  if (bounds.totalDays <= 1) return 0;
  return Math.min(1, Math.max(0, offset / (bounds.totalDays - 1)));
}

export type FishboneLeaf = {
  id: number;
  title: string;
  color: string | null;
  x: number;
  y: number;
};

export type FishboneBook = {
  textbook: string;
  /** 骨枝在肋骨上的落点。 */
  baseX: number;
  baseY: number;
  /** 骨枝末端（课本标签位置）。 */
  x: number;
  y: number;
  leaves: FishboneLeaf[];
};

export type FishboneRib = {
  subject: string;
  /** 肋骨在主干上的起点。 */
  anchorX: number;
  /** 肋骨末端（学科标签位置）。 */
  endX: number;
  endY: number;
  /** 往上是 -1，往下是 1。 */
  direction: -1 | 1;
  books: FishboneBook[];
};

export type FishboneLayout = {
  width: number;
  height: number;
  spineY: number;
  spineStart: number;
  spineEnd: number;
  ribs: FishboneRib[];
};

const SPINE_START = 130;
const SPINE_END = 820;
const RIB_DX = 58;
const RIB_DY = 96;
/** 两条肋骨之间至少留这么宽，不然标签会撞。 */
const MIN_RIB_STEP = 132;
const BOOK_DX = 34;
const BOOK_DY = 12;
const LEAF_DY = 16;
const LEAF_DX = 17;
/** 叶子最多画几个，超出只给数字。 */
export const FISHBONE_MAX_LEAVES = 6;

/** 按字数截断标签，超出加省略号。 */
export function truncateLabel(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * 鱼骨图布局：主干是「总计划」，肋骨是学科，骨上再挂课本，课本下挂任务。
 *
 * 纯函数，坐标一次算好，组件只负责画。
 * 学科多的时候主干自动变长，课本多的时候肋骨自动变长，不靠缩放硬塞。
 */
export function layoutFishbone(tasks: Task[]): FishboneLayout {
  const bySubject = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.subject?.trim() || "未分科";
    const list = bySubject.get(key) ?? [];
    list.push(task);
    bySubject.set(key, list);
  }

  const subjects = [...bySubject.keys()].sort((a, b) => {
    const countA = bySubject.get(a)?.length ?? 0;
    const countB = bySubject.get(b)?.length ?? 0;
    if (countA !== countB) return countB - countA;
    return a.localeCompare(b);
  });

  // 先把每个学科的课本分组，肋骨长度要按课本数量算。
  const bookLists = subjects.map((subject) => {
    const byTextbook = new Map<string, Task[]>();
    for (const task of bySubject.get(subject) ?? []) {
      const key = task.textbook?.trim() || "未指定课本";
      const list = byTextbook.get(key) ?? [];
      list.push(task);
      byTextbook.set(key, list);
    }
    return {
      textbooks: [...byTextbook.keys()].sort((a, b) => a.localeCompare(b)),
      byTextbook,
    };
  });

  const ribLengths = bookLists.map(
    (entry) => Math.max(RIB_DY, entry.textbooks.length * 28),
  );
  const upExtent = Math.max(
    0,
    ...ribLengths.filter((_, index) => index % 2 === 0),
  );
  const downExtent = Math.max(
    0,
    ...ribLengths.filter((_, index) => index % 2 === 1),
  );
  const spineLen = Math.max(
    SPINE_END - SPINE_START,
    subjects.length * MIN_RIB_STEP,
  );
  const spineEnd = SPINE_START + spineLen;
  const step = subjects.length > 0 ? spineLen / subjects.length : 0;
  const spineY = upExtent + 48;

  const ribs: FishboneRib[] = subjects.map((subject, index) => {
    const direction: -1 | 1 = index % 2 === 0 ? -1 : 1;
    const anchorX = SPINE_START + step * (index + 0.5);
    const ribLen = ribLengths[index];
    const endX = anchorX + RIB_DX;
    const endY = spineY + direction * ribLen;
    const entry = bookLists[index];

    const books: FishboneBook[] = entry.textbooks.map((textbook, bookIndex) => {
      const t = (bookIndex + 1) / (entry.textbooks.length + 1);
      const baseX = anchorX + RIB_DX * t;
      const baseY = spineY + direction * ribLen * t;
      const x = baseX + BOOK_DX * 0.6;
      const y = baseY + direction * BOOK_DY * 1.6;
      const leaves: FishboneLeaf[] = (entry.byTextbook.get(textbook) ?? [])
        .slice(0, FISHBONE_MAX_LEAVES)
        .map((task, leafIndex) => ({
          id: task.id,
          title: task.title,
          color: task.color,
          x: x + 10 + leafIndex * LEAF_DX,
          y: y + direction * LEAF_DY,
        }));
      return { textbook, baseX, baseY, x, y, leaves };
    });

    return { subject, anchorX, endX, endY, direction, books };
  });

  const width = spineEnd + RIB_DX + BOOK_DX + 120;
  return {
    width,
    height: spineY + downExtent + 76,
    spineY,
    spineStart: SPINE_START,
    spineEnd,
    ribs,
  };
}
