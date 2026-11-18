import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetail } from "../../TaskDetail";
import type { Task } from "../../../types";

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
  actual_units_sum: 0,
};

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/tasks/1"]}>
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockApis(planResult: unknown) {
  mockedInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "get_task":
        return task;
      case "list_sessions_by_task":
        return [];
      case "task_progress":
        return { round_units: 0, total_units_done: 0 };
      case "get_task_knowledge_points":
        return null;
      case "generate_week_plan":
        return planResult;
      default:
        return null;
    }
  });
}

describe("TaskDetail 一键排一周", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("task_detail_week_plan_generates_schedule_and_reports", async () => {
    mockApis({ taskId: 1, created: 21, skipped: 0, lastDate: "2026-11-24" });

    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "一键排一周" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("已排 21 个排期，铺到 11月24日。");
    });
    expect(mockedInvoke).toHaveBeenCalledWith("generate_week_plan", {
      input: { taskId: 1, days: 7 },
    });
  });

  it("task_detail_week_plan_reports_skipped_slots", async () => {
    mockApis({ taskId: 1, created: 12, skipped: 9, lastDate: "2026-11-24" });

    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "一键排一周" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "已排 12 个排期，铺到 11月24日；跳过 9 个被占用或超上限的时段。",
      );
    });
  });

  it("task_detail_week_plan_says_when_no_slot_is_free", async () => {
    mockApis({ taskId: 1, created: 0, skipped: 21, lastDate: null });

    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "一键排一周" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("没有空位可排");
    });
  });
});