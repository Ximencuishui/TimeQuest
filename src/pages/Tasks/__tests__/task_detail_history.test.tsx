import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetail } from "../../TaskDetail";
import type { Task, TaskSession } from "../../../types";

const mockedInvoke = vi.mocked(invoke);

const task: Task = {
  id: 1,
  title: "主线数学",
  type: "main",
  subject: "数学",
  textbook: null,
  unit_name: "课",
  total_units: 20,
  total_rounds: 4,
  current_round: 1,
  color: "#F97316",
  archived: 0,
  created_at: "2026-01-01 10:00:00",
  actual_units_sum: 0,
};

const STATUSES: Array<TaskSession["status"]> = [
  "done",
  "planned",
  "rescheduled",
  "done",
];

function makeSession(
  id: number,
  round: number,
  status: TaskSession["status"] = "planned",
): TaskSession {
  return {
    id,
    task_id: 1,
    date: `2026-11-${String(((id - 1) % 28) + 1).padStart(2, "0")}`,
    start_time: "09:00",
    end_time: "10:00",
    round,
    status,
    planned_units: 1,
    actual_units: status === "done" ? 1 : 0,
    self_rating: status === "done" ? 3 : null,
    self_note: null,
    rescheduled_to: null,
    xp_awarded: status === "done" ? 10 : 0,
    created_at: "2026-11-01 10:00:00",
    // 不设 task_type，避免 SessionCard 副文案「第N轮」干扰历史区 h3 断言。
  };
}

/** 4 轮 × 20 条 = 80；status 在 done/planned/rescheduled 间轮转。 */
function sessions80(): TaskSession[] {
  const out: TaskSession[] = [];
  let id = 1;
  for (let round = 1; round <= 4; round++) {
    for (let i = 0; i < 20; i++) {
      out.push(makeSession(id, round, STATUSES[i % STATUSES.length]!));
      id += 1;
    }
  }
  return out;
}

function renderDetail(client?: QueryClient, taskId = 1) {
  const qc =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/tasks/${taskId}`]}>
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client: qc };
}

function mockDetailApis(opts: {
  progress: { round_units: number; total_units_done: number };
  sessions: TaskSession[];
  taskOverride?: Partial<Task>;
}) {
  const t = { ...task, ...opts.taskOverride };
  mockedInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "get_task":
        return t;
      case "list_sessions_by_task":
        return opts.sessions;
      case "task_progress":
        // C/进度环既有约定：wire 为 round_units / total_units_done
        //（非提示词里的 current_round_units）。
        return opts.progress;
      default:
        return null;
    }
  });
}

function countListSessionsInvokes() {
  return mockedInvoke.mock.calls.filter((c) => c[0] === "list_sessions_by_task")
    .length;
}

function historyRoundHeadings() {
  return screen
    .getAllByRole("heading", { level: 3 })
    .map((el) => el.textContent ?? "");
}

describe("TaskDetail history list", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("task_detail_history_renders_all_sessions_without_truncation", async () => {
    // C 段：list_sessions_by_task 无 LIMIT；TaskDetail 直接 map 全部，无 slice/分页。
    const sessions = sessions80();
    expect(sessions).toHaveLength(80);

    mockDetailApis({
      progress: { round_units: 0, total_units_done: 0 },
      sessions,
      taskOverride: { current_round: 4, total_rounds: 4 },
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByText("排期历史")).toBeInTheDocument();
    });

    expect(document.querySelectorAll("article")).toHaveLength(80);

    const headers = historyRoundHeadings();
    expect(headers.some((t) => t.includes("第 1 轮"))).toBe(true);
    expect(headers.some((t) => t.includes("第 2 轮"))).toBe(true);
    expect(headers.some((t) => t.includes("第 3 轮"))).toBe(true);
    expect(headers.some((t) => t.includes("第 4 轮"))).toBe(true);

    // 现状无分页；未来若加「加载更多」本断言红灯，提醒同步标题来源。
    expect(screen.queryByRole("button", { name: /加载更多/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/加载更多/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/分页|页码|下一页/)).not.toBeInTheDocument();
  });

  it("task_detail_history_round_headers_come_from_sessions", async () => {
    // C 段第 5 条：轮次标题从 sessions 按 round 分组推导，不读 task.current_round。
    // 空轮不显示标题是当前选择。
    const sessions = [
      makeSession(1, 1, "done"),
      makeSession(2, 1, "planned"),
      makeSession(3, 3, "done"),
      makeSession(4, 3, "rescheduled"),
    ];

    mockDetailApis({
      progress: { round_units: 0, total_units_done: 2 },
      sessions,
      taskOverride: { current_round: 4, total_rounds: 4, total_units: 20 },
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByText("排期历史")).toBeInTheDocument();
    });

    // 页头仍显示当前第 4 轮（读 task.current_round），与历史区标题来源不同。
    expect(screen.getByText(/当前第\s*4\s*\/\s*4\s*轮/)).toBeInTheDocument();

    const headers = historyRoundHeadings();
    expect(headers.some((t) => t.includes("第 1 轮"))).toBe(true);
    expect(headers.some((t) => t.includes("第 3 轮"))).toBe(true);
    expect(headers.some((t) => t.includes("第 2 轮"))).toBe(false);
    expect(headers.some((t) => t.includes("第 4 轮"))).toBe(false);
  });

  it("task_detail_history_does_not_refetch_on_progress_update", async () => {
    // C 段 / hooks：sessions-task 与 task-progress 是两条独立 query key。
    mockDetailApis({
      progress: { round_units: 0, total_units_done: 0 },
      sessions: [makeSession(1, 1, "done"), makeSession(2, 1, "planned")],
      taskOverride: { current_round: 1 },
    });

    const { client } = renderDetail();

    await waitFor(() => {
      expect(screen.getByText("排期历史")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/本轮\s*0\/20/)).toBeInTheDocument();
    });

    const sessionsBefore = countListSessionsInvokes();
    expect(sessionsBefore).toBeGreaterThanOrEqual(1);

    // 只更新进度环缓存，不触碰 sessions-task。
    client.setQueryData(["task-progress", 1], {
      round_units: 7,
      total_units_done: 7,
    });

    await waitFor(() => {
      expect(screen.getByText(/本轮\s*7\/20/)).toBeInTheDocument();
    });

    expect(countListSessionsInvokes()).toBe(sessionsBefore);
  });
});
