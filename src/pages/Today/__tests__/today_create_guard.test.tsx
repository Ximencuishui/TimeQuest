import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskSession } from "../../../types";
import { Today } from "../../Today";

const mockedInvoke = vi.mocked(invoke);

const mainTask: Task = {
  id: 1,
  title: "物理必修二 第一轮",
  type: "main",
  subject: "物理",
  textbook: null,
  unit_name: "课",
  total_units: 40,
  total_rounds: 2,
  current_round: 1,
  color: "#F97316",
  archived: 0,
  created_at: "2026-11-01 10:00:00",
};

const existing: TaskSession = {
  id: 7,
  task_id: 1,
  date: "2026-11-06",
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
  created_at: "2026-11-06 08:00:00",
  task_title: "物理必修二 第一轮",
  task_type: "main",
};

function callsFor(cmd: string): number {
  return mockedInvoke.mock.calls.filter((call) => call[0] === cmd).length;
}

/** 打开「新建排期」弹窗并选好任务，等数据到位后才允许提交。 */
async function openCreateDialog() {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "新建排期" })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole("button", { name: "新建排期" }));

  await waitFor(() => {
    expect(screen.getByRole("option", { name: /物理必修二/ })).toBeInTheDocument();
  });
  // 任务下拉框默认选第一项；这里显式选一次，保证 taskId 已就位。
  fireEvent.change(screen.getByLabelText("任务"), { target: { value: "1" } });
}

function renderToday() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Today />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Today create guard", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [mainTask];
      if (cmd === "list_sessions_by_date") return [existing];
      if (cmd === "find_overlaps") return [existing];
      if (cmd === "create_session") return existing;
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("today_create_confirms_overlap_before_saving", async () => {
    renderToday();

    await openCreateDialog();

    // 默认 09:00–10:00，与已有排期重叠。
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(screen.getByText("时段重叠")).toBeInTheDocument();
    });
    expect(callsFor("create_session")).toBe(0);
    expect(screen.getByText(/和下面 1 条排期重叠/)).toBeInTheDocument();

    // 选「改时间」：不保存，回到编辑状态。
    fireEvent.click(screen.getByRole("button", { name: "改时间" }));
    await waitFor(() => {
      expect(screen.queryByText("时段重叠")).not.toBeInTheDocument();
    });
    expect(callsFor("create_session")).toBe(0);

    // 再提交一次并选「仍然保存」：这次才落库。
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => {
      expect(screen.getByText("时段重叠")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "仍然保存" }));
    await waitFor(() => {
      expect(callsFor("create_session")).toBe(1);
    });
  });

  it("today_create_rejects_inverted_time_range_without_calling_backend", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [mainTask];
      if (cmd === "list_sessions_by_date") return [existing];
      if (cmd === "create_session") return existing;
      return null;
    });

    renderToday();

    await openCreateDialog();

    const start = screen.getByLabelText("开始") as HTMLInputElement;
    const end = screen.getByLabelText("结束") as HTMLInputElement;
    fireEvent.change(start, { target: { value: "20:00" } });
    fireEvent.change(end, { target: { value: "10:00" } });

    const createButton = screen.getByRole("button", { name: "创建" }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("不能早于开始时间");
    expect(callsFor("create_session")).toBe(0);
    expect(callsFor("find_overlaps")).toBe(0);
  });
});
