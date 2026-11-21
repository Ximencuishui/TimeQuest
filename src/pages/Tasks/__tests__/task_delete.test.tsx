import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetail } from "../../TaskDetail";
import { KnowledgePointDrawer } from "../../../components/KnowledgePointDrawer";
import type { Task } from "../../../types";

const mockedInvoke = vi.mocked(invoke);

const task: Task = {
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

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/tasks/1"]}>
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetail />} />
          <Route path="/tasks" element={<p>总计划列表</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderDrawer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/tasks"]}>
        <KnowledgePointDrawer task={task} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("任务详情里的编辑 / 搁置 / 删除", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_task":
          return task;
        case "task_progress":
          return { round_units: 0, total_units_done: 0 };
        case "list_sessions_by_task":
          return [];
        case "get_task_knowledge_points":
          return [];
        case "list_task_prerequisite_conflicts":
          return [];
        case "list_available_textbooks":
          return [];
        case "update_task":
          return task;
        default:
          return null;
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("task_detail_offers_edit_shelve_and_delete", async () => {
    renderDetail();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "数学必修一" })).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "搁置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });

  it("task_detail_shelve_archives_the_task", async () => {
    renderDetail();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "搁置" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "搁置" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("archive_task", {
        id: 1,
        archived: true,
      });
    });
  });

  it("task_detail_delete_asks_for_confirmation_first", async () => {
    renderDetail();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    // 确认框出现，但还没删。
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/排期和学习记录都留着/)).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_task", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_task", expect.anything());
  });

  it("task_detail_delete_moves_the_task_to_the_trash_and_returns_to_the_list", async () => {
    renderDetail();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "移到回收站" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("delete_task", { id: 1 });
    });
    await waitFor(() => {
      expect(screen.getByText("总计划列表")).toBeInTheDocument();
    });
  });

  it("knowledge_drawer_also_offers_shelve_and_delete", async () => {
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "搁置" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开任务详情" })).toBeInTheDocument();
  });
});
