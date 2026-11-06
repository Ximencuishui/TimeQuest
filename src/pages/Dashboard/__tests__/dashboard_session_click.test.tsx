import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../../../store/ui";
import type { TaskSession } from "../../../types";
import { Dashboard } from "../../Dashboard";
import { TodayRoute } from "../../Today";

const mockedInvoke = vi.mocked(invoke);

const session: TaskSession = {
  id: 11,
  task_id: 1,
  date: "2026-11-06",
  start_time: "19:00",
  end_time: "20:00",
  round: 1,
  status: "planned",
  planned_units: 2,
  actual_units: 0,
  self_rating: null,
  self_note: null,
  rescheduled_to: null,
  xp_awarded: 0,
  created_at: "2026-11-06 08:00:00",
  task_title: "晚自习",
  task_type: "main",
  subject: "数学",
};

function renderShell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/today" element={<TodayRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Dashboard session card", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().setExams([
      { id: "gaokao", name: "高考", date: "2027-06-07", isPrimary: true },
    ]);
    Element.prototype.scrollIntoView = vi.fn();
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_sessions_by_date") return [session];
      if (cmd === "list_tasks") return [];
      if (cmd === "stats_daily_units") return [];
      if (cmd === "list_exam_records") return [];
      if (cmd === "get_user_stats") {
        return {
          id: 1,
          total_xp: 0,
          current_level: 1,
          current_streak: 0,
          longest_streak: 0,
          last_done_date: null,
        };
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("dashboard_session_card_opens_today_and_scrolls_to_session", async () => {
    renderShell();

    const card = await screen.findByRole("button", { name: /晚自习/ });
    expect(card.className).toContain("cursor-pointer");

    fireEvent.click(card);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "今日计划" })).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
      });
    });

    const targets = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock
      .instances as HTMLElement[];
    expect(
      targets.some((el) => el.querySelector?.('[data-session-id="11"]') != null),
    ).toBe(true);
  });
});
