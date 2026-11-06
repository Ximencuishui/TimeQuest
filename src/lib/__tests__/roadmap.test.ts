import { describe, expect, it } from "vitest";
import {
  isRoadmapTaskComplete,
  markerPoint,
  markerProgress,
  nodeStatus,
  roadmapNodePoints,
  selectRoadmapTasks,
  taskProgressRatio,
  type RoadmapTask,
} from "../roadmap";

function task(partial: Partial<RoadmapTask>): RoadmapTask {
  return {
    id: 1,
    title: "数学必修一",
    type: "main",
    subject: "数学",
    textbook: "必修一",
    unit_name: "课",
    total_units: 10,
    total_rounds: 3,
    current_round: 1,
    color: "#F97316",
    archived: 0,
    created_at: "2026-01-01 00:00:00",
    ...partial,
  };
}

describe("roadmap helpers", () => {
  it("selects main non-archived tasks oldest first capped at 4", () => {
    const picked = selectRoadmapTasks([
      task({ id: 5, title: "侧线", type: "side", created_at: "2026-01-01 00:00:00" }),
      task({ id: 2, title: "B", created_at: "2026-01-03 00:00:00" }),
      task({ id: 1, title: "A", created_at: "2026-01-02 00:00:00" }),
      task({ id: 9, title: "归档", archived: 1, created_at: "2026-01-01 00:00:00" }),
      task({ id: 3, title: "C", created_at: "2026-01-04 00:00:00" }),
      task({ id: 4, title: "D", created_at: "2026-01-05 00:00:00" }),
      task({ id: 6, title: "E", created_at: "2026-01-06 00:00:00" }),
    ]);
    expect(picked.map((t) => t.title)).toEqual(["A", "B", "C", "D"]);
  });

  it("computes progress ratio and status buckets", () => {
    expect(taskProgressRatio(task({ total_units: 10, actual_units_sum: 0 }))).toBe(0);
    expect(nodeStatus(task({ total_units: 10, actual_units_sum: 0 }))).toBe("idle");
    expect(taskProgressRatio(task({ total_units: 10, actual_units_sum: 4 }))).toBe(0.4);
    expect(nodeStatus(task({ total_units: 10, actual_units_sum: 4 }))).toBe("active");
    expect(isRoadmapTaskComplete(task({ total_units: 10, actual_units_sum: 10 }))).toBe(true);
    expect(nodeStatus(task({ total_units: 10, actual_units_sum: 12 }))).toBe("done");
    expect(taskProgressRatio(task({ total_units: null, actual_units_sum: 5 }))).toBe(0);
  });

  it("marker progress is completed count over node count", () => {
    const nodes = [
      task({ id: 1, actual_units_sum: 10 }),
      task({ id: 2, actual_units_sum: 3 }),
    ];
    expect(markerProgress(nodes)).toBe(0.5);
    expect(markerProgress([])).toBe(0);
  });

  it("places even node points and interpolates marker", () => {
    const pts = roadmapNodePoints(2);
    expect(pts).toHaveLength(2);
    expect(pts[0].x).toBeLessThan(pts[1].x);
    const mid = markerPoint(pts, 0.5);
    expect(mid.x).toBeCloseTo((pts[0].x + pts[1].x) / 2);
  });
});
