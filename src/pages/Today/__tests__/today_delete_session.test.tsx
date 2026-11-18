import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const planned: TaskSession = {
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

const done: TaskSession = {
  ...planned,
  id: 8,
  start_time: "11:00",
  end_time: "12:00",
  status: "done",
  actual_units: 2,
  xp_awarded: 24,
};

function deleteCalls(): unknown[][] {
  return mockedInvoke.mock.calls.filter((call) => call[0] === "delete_session");
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

describe("Today delete planned session", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [mainTask];
      if (cmd === "list_sessions_by_date") return [planned, done];
      if (cmd === "delete_session") return null;
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("today_delete_asks_confirmation_then_calls_delete_session", async () => {
    renderToday();

    await waitFor(() => {
      expect(screen.getAllByText("物理必修二 第一轮").length).toBeGreaterThan(0);
    });

    // 已完成的场次没有删除按钮。
    const cards = document.querySelectorAll("[data-session-id]");
    const doneCard = Array.from(cards).find(
      (el) => el.getAttribute("data-session-id") === "8",
    );
    const plannedCard = Array.from(cards).find(
      (el) => el.getAttribute("data-session-id") === "7",
    );
    expect(doneCard?.textContent).not.toContain("删除");
    expect(plannedCard?.textContent).toContain("删除");

    fireEvent.click(screen.getAllByRole("button", { name: "删除" })[0]!);

    await waitFor(() => {
      expect(screen.getByText("删除这条排期？")).toBeInTheDocument();
    });
    expect(deleteCalls()).toHaveLength(0);

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(deleteCalls()).toHaveLength(1);
    });
    expect(deleteCalls()[0]![1]).toEqual({ sessionId: 7 });
  });

  it("today_delete_cancel_keeps_the_session", async () => {
    renderToday();

    await waitFor(() => {
      expect(screen.getAllByText("物理必修二 第一轮").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole("button", { name: "删除" })[0]!);
    await waitFor(() => {
      expect(screen.getByText("删除这条排期？")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(screen.queryByText("删除这条排期？")).not.toBeInTheDocument();
    });
    expect(deleteCalls()).toHaveLength(0);
  });
});
