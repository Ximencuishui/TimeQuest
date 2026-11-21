import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../../../store/ui";
import type { Task } from "../../../types";
import { Tasks } from "../../Tasks";

const mockedInvoke = vi.mocked(invoke);

const deletedTask: Task = {
  id: 9,
  title: "化学选修二",
  type: "main",
  subject: "化学",
  textbook: "人教版",
  unit_name: "课",
  total_units: 12,
  total_rounds: 1,
  current_round: 1,
  color: "#34D399",
  archived: 0,
  created_at: "2026-01-03 10:00:00",
  deleted_at: "2026-11-20 21:30:00",
  actual_units_sum: 3,
};

function renderTasks() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

describe("总计划页的回收站", () => {
  beforeEach(() => {
    useUiStore.setState({ taskView: "list" });
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [];
      if (cmd === "list_sessions_in_range") return [];
      if (cmd === "list_deleted_tasks") return [deletedTask];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    useUiStore.setState({ taskView: "list" });
  });

  it("recycle_bin_stays_closed_until_the_toggle_is_opened", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByTestId("task-list-view")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("recycle-bin")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "回收站" }));

    await waitFor(() => {
      expect(screen.getByText("化学选修二")).toBeInTheDocument();
    });
    expect(screen.getByTestId("recycle-bin")).toBeInTheDocument();
    expect(screen.getByText(/已于 2026-11-20 移到回收站/)).toBeInTheDocument();
  });

  it("recycle_bin_restores_a_deleted_task", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByTestId("task-list-view")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    await waitFor(() => {
      expect(screen.getByText("化学选修二")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "恢复" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("restore_task", { id: 9 });
    });
    await waitFor(() => {
      expect(screen.getByText("「化学选修二」已找回来了。")).toBeInTheDocument();
    });
  });

  it("recycle_bin_shows_an_empty_state_when_nothing_was_deleted", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [];
      if (cmd === "list_sessions_in_range") return [];
      if (cmd === "list_deleted_tasks") return [];
      return null;
    });

    renderTasks();

    await waitFor(() => {
      expect(screen.getByTestId("task-list-view")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));

    await waitFor(() => {
      expect(screen.getByText(/回收站是空的/)).toBeInTheDocument();
    });
    expect(screen.getByTestId("recycle-bin")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复" })).not.toBeInTheDocument();
  });

  it("recycle_bin_asks_for_confirmation_before_purging", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByTestId("task-list-view")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    await waitFor(() => {
      expect(screen.getByText("化学选修二")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "彻底清除" }));

    // 确认框出现，但还没删。
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/都会一起删掉，无法恢复/)).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("purge_task", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("purge_task", expect.anything());
  });

  it("recycle_bin_purge_removes_the_task_for_good", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByTestId("task-list-view")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    await waitFor(() => {
      expect(screen.getByText("化学选修二")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "彻底清除" }));
    fireEvent.click(screen.getByRole("button", { name: "彻底删除" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("purge_task", { id: 9 });
    });
  });

  it("recycle_bin_invalidates_the_plan_sessions_cache", async () => {
    const { client } = renderTasks();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await waitFor(() => {
      expect(screen.getByTestId("task-list-view")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    await waitFor(() => {
      expect(screen.getByText("化学选修二")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "恢复" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("restore_task", { id: 9 });
    });
    // 总计划页的日历/甘特视图靠 `sessions-range` 这份缓存，
    // 漏了它恢复后排期就会停在旧数据上（React Query 前缀匹配命中不了）。
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["sessions-range"] });
  });

  it("recycle_bin_shows_an_error_when_the_restore_fails", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [];
      if (cmd === "list_sessions_in_range") return [];
      if (cmd === "list_deleted_tasks") return [deletedTask];
      if (cmd === "restore_task") throw new Error("任务 9 不在回收站里");
      return null;
    });
    renderTasks();

    await waitFor(() => {
      expect(screen.getByTestId("task-list-view")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    await waitFor(() => {
      expect(screen.getByText("化学选修二")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "恢复" }));

    // 失败要看得见：不能静默地什么都没发生。
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("任务 9 不在回收站里");
    });
  });
});