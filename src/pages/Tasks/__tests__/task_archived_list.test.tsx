import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../../../store/ui";
import type { Task } from "../../../types";
import { Tasks } from "../../Tasks";

const mockedInvoke = vi.mocked(invoke);

function recordArgs(args?: InvokeArgs): Record<string, unknown> {
  if (!args || Array.isArray(args) || args instanceof ArrayBuffer || args instanceof Uint8Array) {
    return {};
  }
  return args;
}

const activeTask: Task = {
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
  actual_units_sum: 0,
};

const archivedTask: Task = {
  ...activeTask,
  id: 9,
  title: "已归档的英语",
  type: "side",
  subject: null,
  textbook: null,
  archived: 1,
};

function renderTasks() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Tasks archived list", () => {
  beforeEach(() => {
    useUiStore.setState({ taskView: "list" });
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: InvokeArgs) => {
      const input = recordArgs(args);
      if (cmd === "list_tasks") {
        return input.includeArchived ? [activeTask, archivedTask] : [activeTask];
      }
      if (cmd === "archive_task") return null;
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    useUiStore.setState({ taskView: "list" });
  });

  it("archived_task_is_hidden_until_the_switch_is_on", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByText("数学必修一")).toBeInTheDocument();
    });
    expect(screen.queryByText("已归档的英语")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "已归档" })).not.toBeInTheDocument();
  });

  it("archived_task_can_be_restored_from_the_archived_group", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示已归档任务" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "显示已归档任务" }));

    expect(await screen.findByRole("heading", { name: "已归档" })).toBeInTheDocument();
    expect(screen.getByText("已归档的英语")).toBeInTheDocument();
    // 归档任务不进知识点抽屉，只留查看和取消搁置。
    expect(
      screen.queryByRole("button", { name: "查看知识点 已归档的英语" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消搁置 已归档的英语" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("archive_task", {
        id: 9,
        archived: false,
      });
    });
  });

  it("archived_task_is_listed_only_when_include_archived_is_requested", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示已归档任务" })).toBeInTheDocument();
    });

    expect(mockedInvoke).toHaveBeenCalledWith("list_tasks", { includeArchived: false });

    fireEvent.click(screen.getByRole("button", { name: "显示已归档任务" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("list_tasks", { includeArchived: true });
    });
  });
});
