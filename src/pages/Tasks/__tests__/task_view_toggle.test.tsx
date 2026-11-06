import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../../../store/ui";
import type { Task } from "../../../types";
import { Tasks } from "../../Tasks";

const mockedInvoke = vi.mocked(invoke);

const sideTask: Task = {
  id: 2,
  title: "英语听力",
  type: "side",
  subject: null,
  textbook: null,
  unit_name: "课",
  total_units: null,
  total_rounds: 1,
  current_round: 1,
  color: "#14B8A6",
  archived: 0,
  created_at: "2026-01-01 10:00:00",
};

function listTaskCalls(): number {
  return mockedInvoke.mock.calls.filter((call) => call[0] === "list_tasks").length;
}

function renderTasks() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Tasks view toggle", () => {
  beforeEach(() => {
    useUiStore.setState({ taskView: "list" });
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [sideTask];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    useUiStore.setState({ taskView: "list" });
  });

  it("task_view_toggle_unmounts_list_and_skips_refetch", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByTestId("task-list-view")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "主线" })).toBeInTheDocument();
    expect(screen.getByText("英语听力")).toBeInTheDocument();
    expect(screen.queryByTestId("task-grid-view")).not.toBeInTheDocument();
    expect(useUiStore.getState().taskView).toBe("list");
    const before = listTaskCalls();
    expect(before).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "网格视图" }));

    expect(screen.queryByTestId("task-list-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("task-grid-view")).toBeInTheDocument();
    expect(screen.queryByText("六边形拼图视图正在建设中，敬请期待")).not.toBeInTheDocument();
    expect(screen.getByText("英语听力")).toBeInTheDocument();
    expect(screen.getByTestId("side-task-icon")).toBeInTheDocument();
    expect(screen.queryByTestId("micro-cell")).not.toBeInTheDocument();
    expect(useUiStore.getState().taskView).toBe("grid");
    expect(listTaskCalls()).toBe(before);

    fireEvent.click(screen.getByRole("button", { name: "列表视图" }));

    expect(screen.getByTestId("task-list-view")).toBeInTheDocument();
    expect(screen.getByText("英语听力")).toBeInTheDocument();
    expect(screen.queryByTestId("task-grid-view")).not.toBeInTheDocument();
    expect(listTaskCalls()).toBe(before);
  });
});