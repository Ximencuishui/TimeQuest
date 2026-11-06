import type { Task } from "../types";

export type RoadmapTask = Task & { current_round_units?: number };

export type Point = { x: number; y: number };

export type NodeStatus = "done" | "active" | "idle";

export const ROADMAP_VB = { w: 400, h: 160 } as const;
export const ROADMAP_MAX_NODES = 4;

/** Main, non-archived tasks, oldest first, capped at 4. */
export function selectRoadmapTasks(tasks: RoadmapTask[]): RoadmapTask[] {
  return tasks
    .filter((t) => t.type === "main" && !t.archived)
    .slice()
    .sort((a, b) => {
      const byCreated = a.created_at.localeCompare(b.created_at);
      return byCreated !== 0 ? byCreated : a.id - b.id;
    })
    .slice(0, ROADMAP_MAX_NODES);
}

export function taskDoneUnits(task: RoadmapTask): number {
  const raw = task.current_round_units ?? task.actual_units_sum ?? 0;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw;
}

/** 0..1 from current-round units / total_units. Null/zero total → 0. */
export function taskProgressRatio(task: RoadmapTask): number {
  const total = task.total_units ?? 0;
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(1, taskDoneUnits(task) / total);
}

export function isRoadmapTaskComplete(task: RoadmapTask): boolean {
  return taskProgressRatio(task) >= 1;
}

export function nodeStatus(task: RoadmapTask): NodeStatus {
  const p = taskProgressRatio(task);
  if (p >= 1) return "done";
  if (p > 0) return "active";
  return "idle";
}

/** completed main nodes / node count → 0..1 along the path. */
export function markerProgress(tasks: RoadmapTask[]): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter(isRoadmapTaskComplete).length;
  return done / tasks.length;
}

/** Evenly spaced waypoints on a gentle S-curve inside the viewBox. */
export function roadmapNodePoints(count: number): Point[] {
  if (count <= 0) return [];
  const { w, h } = ROADMAP_VB;
  const pad = 48;
  const midY = h / 2;
  const amp = 28;
  if (count === 1) return [{ x: w / 2, y: midY }];
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const x = pad + t * (w - 2 * pad);
    // cos(πt): first node high, last low — keeps a visible S even for 2 nodes
    const y = midY + Math.cos(t * Math.PI) * amp;
    return { x, y };
  });
}

/** Rounded polyline through points (quadratic mid controls). */
export function roadmapPathD(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x - 40} ${p.y} L ${p.x + 40} ${p.y}`;
  }
  const first = points[0];
  const last = points[points.length - 1];
  const start = { x: Math.max(8, first.x - 28), y: first.y };
  const end = { x: Math.min(ROADMAP_VB.w - 8, last.x + 28), y: last.y };
  const all = [start, ...points, end];
  let d = `M ${all[0].x} ${all[0].y}`;
  for (let i = 1; i < all.length; i++) {
    const prev = all[i - 1];
    const curr = all[i];
    const cpx = (prev.x + curr.x) / 2;
    // Pull the control point off the chord so the track looks winding
    const cpy = (prev.y + curr.y) / 2 + (curr.y >= prev.y ? -22 : 22);
    d += ` Q ${cpx} ${cpy} ${curr.x} ${curr.y}`;
  }
  return d;
}

/** Interpolate along node waypoints by 0..1 progress. */
export function markerPoint(points: Point[], progress: number): Point {
  if (points.length === 0) return { x: ROADMAP_VB.w / 2, y: ROADMAP_VB.h / 2 };
  if (points.length === 1) return points[0];
  const t = Math.min(1, Math.max(0, progress));
  const scaled = t * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const a = points[i];
  const b = points[i + 1];
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
  };
}
