import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../../../store/ui";
import type { Task, TaskSession } from "../../../types";
import { Tasks } from "../../Tasks";

const mockedInvoke = vi.mocked(invoke);

const mathTask: Task = {
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
};

const physicsTask: Task = {
  id: 2,
  title: "物理必修二",
  type: "main",
  subject: "物理",
  textbook: "人教版",
  unit_name: "课",
  total_units: 16,
  total_rounds: 3,
  current_round: 2,
  color: "#14B8A6",
  archived: 0,
  created_at: "2026-01-02 10:00:00",
  actual_units_sum: 2,
};

const sessions: TaskSession[] = [
  {
    id: 11,
    task_id: 1,
    date: "2026-03-01",
    start_time: "09:00",
    end_time: "10:30",
    round: 1,
    status: "planned",
    planned_units: 2,
    actual_units: 0,
    self_rating: null,
    self_note: null,
    rescheduled_to: null,
    xp_awarded: 0,
    created_at: "2026-02-01 10:00:00",
    task_title: "数学必修一",
    task_color: "#F97316",
  },
  {
    id: 12,
    task_id: 2,
    date: "2026-03-02",
    start_time: "14:00",
    end_time: "15:00",
    round: 1,
    status: "planned",
    planned_units: 1,
    actual_units: 0,
    self_rating: null,
    self_note: null,
    rescheduled_to: null,
    xp_awarded: 0,
    created_at: "2026-02-01 10:00:00",
    task_title: "物理必修二",
    task_color: "#14B8A6",
  },
];

function renderTasks() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("总计划视图", () => {
  beforeEach(() => {
    useUiStore.setState({ taskView: "list" });
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [mathTask, physicsTask];
      if (cmd === "list_sessions_in_range") return sessions;
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    useUiStore.setState({ taskView: "list" });
  });

  it("tasks_page_switches_between_the_five_plan_views", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByTestId("task-list-view")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "总计划" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "日历视图" }));
    expect(screen.getByTestId("plan-calendar-view")).toBeInTheDocument();
    expect(screen.queryByTestId("task-list-view")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "甘特视图" }));
    expect(screen.getByTestId("plan-gantt-view")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "鱼骨视图" }));
    expect(screen.getByTestId("plan-fishbone-view")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "网格视图" }));
    expect(screen.getByTestId("task-grid-view")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "列表视图" }));
    expect(screen.getByTestId("task-list-view")).toBeInTheDocument();
  });

  it("tasks_page_filter_narrows_the_task_list", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByText("数学必修一")).toBeInTheDocument();
    });
    expect(screen.getByText("物理必修二")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("plan-filter-subjects-数学"));

    await waitFor(() => {
      expect(screen.queryByText("物理必修二")).not.toBeInTheDocument();
    });
    expect(screen.getByText("数学必修一")).toBeInTheDocument();
    expect(screen.getByText("命中 1 / 2 个任务")).toBeInTheDocument();
  });

  it("tasks_page_round_filter_keeps_only_the_matching_tasks", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByText("数学必修一")).toBeInTheDocument();
    });

    // 物理任务当前走到第 2 轮，数学任务只有第 1 轮；选第 2 轮只剩物理。
    fireEvent.click(screen.getByTestId("plan-filter-rounds-2"));

    await waitFor(() => {
      expect(screen.queryByText("数学必修一")).not.toBeInTheDocument();
    });
    expect(screen.getByText("物理必修二")).toBeInTheDocument();
  });
});
