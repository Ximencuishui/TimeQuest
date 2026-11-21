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
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TaskDetail edit task", () => {
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

  it("task_detail_edit_prefills_the_form_and_saves_changed_fields", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "数学必修一" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    // 表单预填原任务的值。
    expect(screen.getByLabelText("标题")).toHaveValue("数学必修一");
    expect(screen.getByLabelText("课本")).toHaveValue("人教A版");
    expect(screen.getByLabelText("总课数")).toHaveValue(20);
    expect(screen.getByLabelText("总轮次")).toHaveValue(2);
    // 轮次编号翻译成阶段名：教材学习排在第一轮复习前面。
    expect(
      screen.getByText(/阶段顺序：教材学习 → 第一轮复习/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("标题"), {
      target: { value: "数学必修一 第一轮" },
    });
    fireEvent.change(screen.getByLabelText("总课数"), { target: { value: "24" } });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("update_task", {
        id: 1,
        payload: expect.objectContaining({
          title: "数学必修一 第一轮",
          subject: "数学",
          textbook: "人教A版",
          unit_name: "课",
          total_units: 24,
          total_rounds: 2,
        }),
      });
    });
  });

  it("task_detail_edit_rejects_an_empty_title", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请给任务起个名字");
    expect(mockedInvoke).not.toHaveBeenCalledWith("update_task", expect.anything());
  });

  it("task_detail_edit_does_not_offer_the_main_side_switch", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    // 主线 / 副本不能改：后端 update_task 不接受类型字段。
    expect(screen.queryByRole("button", { name: "主线" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "副本" })).not.toBeInTheDocument();
  });
});
