import { describe, expect, it } from "vitest";
import {
  buildGanttSegments,
  collectPlanTags,
  computeGanttBounds,
  emptyPlanFilter,
  filterPlanTasks,
  layoutFishbone,
  sessionsOfTasks,
  taskMatchesRound,
  toggleFilterValue,
} from "../planViews";
import type { Task, TaskSession } from "../../types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "数学必修一",
    type: "main",
    subject: "数学",
    textbook: "人教A版",
    unit_name: "课",
    total_units: 20,
    total_rounds: 2,
    current_round: 1,
    color: "#F97316",
    archived: 0,
    created_at: "2026-01-01 10:00:00",
    actual_units_sum: 4,
    ...overrides,
  };
}

function session(overrides: Partial<TaskSession> = {}): TaskSession {
  return {
    id: 1,
    task_id: 1,
    date: "2026-03-01",
    start_time: "09:00",
    end_time: "10:00",
    round: 1,
    status: "planned",
    planned_units: 2,
    actual_units: 0,
    self_rating: null,
    self_note: null,
    rescheduled_to: null,
    xp_awarded: 0,
    created_at: "2026-02-01 10:00:00",
    ...overrides,
  };
}

const mathTask = task();
const physicsTask = task({
  id: 2,
  title: "物理必修二",
  subject: "物理",
  textbook: "人教版",
});

describe("总计划筛选", () => {
  it("plan_tags_collect_subject_textbook_and_rounds", () => {
    const sessions = [session({ id: 1, task_id: 1, round: 3 })];

    const tags = collectPlanTags([mathTask, physicsTask], sessions);

    expect(tags.subjects).toEqual(expect.arrayContaining(["数学", "物理"]));
    expect(tags.subjects).toHaveLength(2);
    expect(tags.textbooks).toEqual(
      expect.arrayContaining(["人教A版", "人教版"]),
    );
    expect(tags.textbooks).toHaveLength(2);
    // 轮次取「任务总轮次」和「排期里出现过的最大轮次」里的最大值。
    expect(tags.rounds).toEqual([1, 2, 3]);
  });

  it("plan_round_matches_a_session_or_the_current_round", () => {
    const current = task({ id: 3, current_round: 2 });
    const sessions = [session({ id: 9, task_id: 1, round: 3 })];

    expect(taskMatchesRound(current, 2, sessions)).toBe(true);
    expect(taskMatchesRound(current, 1, sessions)).toBe(false);
    // 第一轮已经排过第二轮的课，第一轮也算命中。
    expect(taskMatchesRound(mathTask, 3, sessions)).toBe(true);
  });

  it("plan_filter_combines_dimensions_with_and_semantics", () => {
    const tasks = [mathTask, physicsTask];
    const sessions = [session({ id: 1, task_id: 1, round: 1 })];

    const bySubject = filterPlanTasks(tasks, sessions, {
      ...emptyPlanFilter(),
      subjects: ["数学"],
    });
    expect(bySubject.map((item) => item.id)).toEqual([1]);

    // 同维度多选是「或」。
    const either = filterPlanTasks(tasks, sessions, {
      ...emptyPlanFilter(),
      subjects: ["数学", "物理"],
    });
    expect(either.map((item) => item.id)).toEqual([1, 2]);

    // 跨维度是「且」：数学 + 人教A版 + 第1轮。
    const combined = filterPlanTasks(tasks, sessions, {
      subjects: ["数学"],
      textbooks: ["人教A版"],
      rounds: [1],
    });
    expect(combined.map((item) => item.id)).toEqual([1]);

    // 组合对不上就一个都不剩。
    const none = filterPlanTasks(tasks, sessions, {
      subjects: ["数学"],
      textbooks: ["人教版"],
      rounds: [],
    });
    expect(none).toEqual([]);
  });

  it("plan_toggle_filter_value_adds_then_removes", () => {
    expect(toggleFilterValue(["数学"], "物理")).toEqual(["数学", "物理"]);
    expect(toggleFilterValue(["数学", "物理"], "数学")).toEqual(["物理"]);
  });

  it("plan_sessions_of_tasks_keeps_only_the_kept_tasks", () => {
    const sessions = [
      session({ id: 1, task_id: 1 }),
      session({ id: 2, task_id: 2 }),
    ];

    expect(sessionsOfTasks(sessions, [mathTask]).map((item) => item.id)).toEqual([1]);
  });
});

describe("总计划甘特段", () => {
  it("plan_gantt_merges_consecutive_days_and_splits_gaps", () => {
    const sessions = [
      session({ id: 1, date: "2026-03-01", status: "done", actual_units: 2 }),
      session({ id: 2, date: "2026-03-02", status: "done", actual_units: 2 }),
      session({ id: 3, date: "2026-03-05", status: "planned" }),
    ];

    const segments = buildGanttSegments(sessions);

    expect(segments).toHaveLength(2);
    expect(segments[0].start).toBe("2026-03-01");
    expect(segments[0].end).toBe("2026-03-02");
    expect(segments[0].days).toBe(2);
    expect(segments[0].status).toBe("done");
    expect(segments[0].doneUnits).toBe(4);
    expect(segments[1].start).toBe("2026-03-05");
    expect(segments[1].status).toBe("planned");
  });

  it("plan_gantt_bounds_cover_today_and_every_session", () => {
    const bounds = computeGanttBounds(
      [session({ date: "2026-03-10" })],
      "2026-03-05",
    );

    expect(bounds.start <= "2026-03-05").toBe(true);
    expect(bounds.end >= "2026-03-10").toBe(true);
    expect(bounds.totalDays).toBeGreaterThan(0);
  });
});

describe("总计划鱼骨布局", () => {
  it("plan_fishbone_groups_by_subject_then_textbook", () => {
    const layout = layoutFishbone([
      mathTask,
      task({ id: 3, title: "数学必修二", textbook: "人教B版" }),
      physicsTask,
    ]);

    expect(layout.ribs.map((rib) => rib.subject)).toEqual(["数学", "物理"]);
    const math = layout.ribs[0];
    expect(math.books.map((book) => book.textbook)).toEqual([
      "人教A版",
      "人教B版",
    ]);
    expect(math.books[0].leaves.map((leaf) => leaf.id)).toEqual([1]);
    // 鱼骨图是交替上下的。
    expect(math.direction).toBe(-1);
    expect(layout.ribs[1].direction).toBe(1);
    expect(layout.spineEnd).toBeGreaterThan(layout.spineStart);
  });

  it("plan_fishbone_falls_back_to_unlabeled_groups", () => {
    const layout = layoutFishbone([task({ id: 9, subject: null, textbook: null })]);

    expect(layout.ribs[0].subject).toBe("未分科");
    expect(layout.ribs[0].books[0].textbook).toBe("未指定课本");
  });
});
