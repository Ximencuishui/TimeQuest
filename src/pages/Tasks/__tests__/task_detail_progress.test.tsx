import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetail } from "../../TaskDetail";
import type { Task, TaskKnowledgePoint, TaskSession } from "../../../types";

const mockedInvoke = vi.mocked(invoke);

const task: Task = {
  id: 1,
  title: "主线数学",
  type: "main",
  subject: "数学",
  textbook: null,
  unit_name: "课",
  total_units: 20,
  total_rounds: 3,
  current_round: 1,
  color: "#F97316",
  archived: 0,
  created_at: "2026-01-01 10:00:00",
  // Intentionally different from task_progress.round_units — must not drive the ring.
  actual_units_sum: 3,
};

/** Client sum of these done+round1 rows = 3; task_progress returns 7. */
const sessionsSumTo3: TaskSession[] = [
  {
    id: 10,
    task_id: 1,
    date: "2026-11-01",
    start_time: "09:00",
    end_time: "10:00",
    round: 1,
    status: "done",
    planned_units: 2,
    actual_units: 2,
    self_rating: 3,
    self_note: null,
    rescheduled_to: null,
    xp_awarded: 20,
    created_at: "2026-11-01 10:00:00",
  },
  {
    id: 11,
    task_id: 1,
    date: "2026-11-02",
    start_time: "09:00",
    end_time: "10:00",
    round: 1,
    status: "done",
    planned_units: 1,
    actual_units: 1,
    self_rating: 3,
    self_note: null,
    rescheduled_to: null,
    xp_awarded: 10,
    created_at: "2026-11-02 10:00:00",
  },
];

function renderDetail(taskId = 1) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/tasks/${taskId}`]}>
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockDetailApis(opts: {
  progress: { round_units: number; total_units_done: number };
  sessions?: TaskSession[];
  taskOverride?: Partial<Task>;
  knowledgePoints?: TaskKnowledgePoint[] | null;
}) {
  const t = { ...task, ...opts.taskOverride };
  const sessions = opts.sessions ?? sessionsSumTo3;
  mockedInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "get_task":
        return t;
      case "list_sessions_by_task":
        return sessions;
      case "task_progress":
        return opts.progress;
      case "get_task_knowledge_points":
        return opts.knowledgePoints ?? null;
      default:
        return null;
    }
  });
}

describe("TaskDetail progress ring", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("task_detail_progress_ring_reads_task_progress", async () => {
    // C 段：task_progress 返回 { round_units, total_units_done }（非 current_round_units）。
    mockDetailApis({
      progress: { round_units: 7, total_units_done: 99 },
      sessions: sessionsSumTo3,
    });

    renderDetail(1);

    await waitFor(() => {
      expect(screen.getByText("7/20")).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "考点" })).not.toBeInTheDocument();
    expect(screen.queryByText("3/20")).not.toBeInTheDocument();

    expect(mockedInvoke).toHaveBeenCalledWith(
      "task_progress",
      expect.objectContaining({ id: 1 }),
    );

    // 文案「本轮」也走同一数据源
    expect(screen.getByText(/本轮\s*7\/20/)).toBeInTheDocument();
  });

  it("task_detail_progress_ring_reflects_advance_round", async () => {
    // 推进到第 2 轮后：本轮合计为 0（对齐 progress_ring_follows_current_round）。
    mockDetailApis({
      progress: { round_units: 0, total_units_done: 10 },
      taskOverride: { current_round: 2 },
      // 旧轮仍有 done 单位；若前端自算且误用全部 sessions 会显示非 0。
      sessions: [
        {
          ...sessionsSumTo3[0]!,
          round: 1,
          actual_units: 5,
          status: "done",
        },
        {
          ...sessionsSumTo3[1]!,
          id: 12,
          round: 1,
          actual_units: 5,
          status: "done",
        },
      ],
    });

    renderDetail(1);

    await waitFor(() => {
      expect(screen.getByText("0/20")).toBeInTheDocument();
    });
    expect(screen.queryByText("10/20")).not.toBeInTheDocument();
    expect(mockedInvoke).toHaveBeenCalledWith(
      "task_progress",
      expect.objectContaining({ id: 1 }),
    );
  });

  it("task_detail_progress_ring_shows_units_above_total", async () => {
    // 数值保留 25（task_progress.round_units 不钳制）。
    // 环心与「本轮」文案显示 25/20，不是 100%+，也不是钳制成 20/20。
    // 弧线 value 在 TaskProgressRing 里 Math.min 到 total，文案不钳制。
    mockDetailApis({
      progress: { round_units: 25, total_units_done: 25 },
      sessions: [
        {
          ...sessionsSumTo3[0]!,
          actual_units: 15,
          planned_units: 15,
          status: "done",
        },
        {
          ...sessionsSumTo3[1]!,
          actual_units: 10,
          planned_units: 10,
          status: "done",
        },
      ],
    });

    renderDetail(1);

    await waitFor(() => {
      expect(screen.getByText("25/20")).toBeInTheDocument();
    });
    expect(screen.getByText(/本轮\s*25\/20/)).toBeInTheDocument();
    expect(screen.queryByText("20/20")).not.toBeInTheDocument();
    expect(screen.queryByText("100%+")).not.toBeInTheDocument();
  });

  it("task_detail_shows_knowledge_points_grouped_by_section", async () => {
    mockDetailApis({
      progress: { round_units: 0, total_units_done: 0 },
      sessions: [],
      knowledgePoints: [
        {
          id: 1,
          task_id: 1,
          section_name: "1.1 集合的概念",
          name: "集合的含义",
          is_mastered: 1,
          position: 0,
        },
        {
          id: 2,
          task_id: 1,
          section_name: "1.1 集合的概念",
          name: "元素与集合的关系",
          is_mastered: 0,
          position: 1,
        },
        {
          id: 3,
          task_id: 1,
          section_name: "1.2 集合间的基本关系",
          name: "子集与真子集",
          is_mastered: 0,
          position: 0,
        },
      ],
    });

    renderDetail(1);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "考点" })).toBeInTheDocument();
    });
    expect(screen.getByText("1.1 集合的概念")).toBeInTheDocument();
    expect(screen.getByText("1.2 集合间的基本关系")).toBeInTheDocument();
    const mastered = screen.getByText("集合的含义");
    expect(mastered).toHaveClass("line-through");
    expect(mastered).toHaveClass("text-green-400");
    expect(screen.getByRole("checkbox", { name: "集合的含义" })).toBeChecked();
    expect(screen.getByText("元素与集合的关系")).not.toHaveClass("line-through");
    expect(screen.getByRole("checkbox", { name: "元素与集合的关系" })).not.toBeChecked();
    expect(screen.getByText("子集与真子集")).not.toHaveClass("line-through");

    fireEvent.click(screen.getByRole("checkbox", { name: "元素与集合的关系" }));
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("toggle_knowledge_point", { id: 2 });
    });
  });
});

/**
 * C 段报告：Tasks 列表卡片用 `list_tasks` 内嵌 SQL 的 `actual_units_sum`
 *（与 task_progress.round_units 同口径），不是对 sessions 客户端求和，
 * 也不是 N 次 task_progress。无 N+1，故不另写
 * task_list_card_reads_task_progress_not_raw_sessions。
 */
