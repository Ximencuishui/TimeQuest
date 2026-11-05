import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompleteDialog } from "../../components/CompleteDialog";
import { computeCountdown, todayStr } from "../../lib/date";
import { useUiStore } from "../../store/ui";
import type { TaskSession, UserStats } from "../../types";
import { Dashboard } from "../Dashboard";
import { Stats } from "../Stats";

/**
 * C 段：考试日期只被 CountdownPanel 读取。
 * 完成弹窗「剩余改到下次」的日期是打开时的本地今天（todayStr），
 * 不是 session 原日期，也不是考试目标。
 * 统计页周/月由 rangeFor(new Date()) 计算。
 * 今日排期用 todayStr() 请求 list_sessions_by_date；连击条读 get_user_stats。
 */

const mockedInvoke = vi.mocked(invoke);
const EXAM_A = "2026-06-07";
const EXAM_B = "2026-07-01";
const EXAM_C = "2026-09-01";
const USER_PICKED = "2026-08-15";

function seedPrimary(date: string) {
  useUiStore.getState().setExams([
    { id: "gaokao", name: "高考", date, isPrimary: true },
  ]);
}

function freezeLocalNoon(year: number, monthIndex: number, day: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(year, monthIndex, day, 12, 0, 0));
}

const session: TaskSession = {
  id: 42,
  task_id: 1,
  date: "2026-05-01",
  start_time: "09:00",
  end_time: "10:00",
  round: 1,
  status: "planned",
  planned_units: 5,
  actual_units: 0,
  self_rating: null,
  self_note: null,
  rescheduled_to: null,
  xp_awarded: 0,
  created_at: "2026-05-01 08:00:00",
  task_title: "主线数学",
  task_type: "main",
};

function renderCompleteDialog() {
  return render(
    <CompleteDialog
      session={session}
      onClose={() => undefined}
      onSubmit={() => undefined}
    />,
  );
}

function deferDateInput(): HTMLInputElement {
  const input = document.querySelector('input[type="date"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("complete dialog defer date input missing");
  }
  return input;
}

function rangeFor(mode: "week" | "month"): string {
  const now = new Date();
  if (mode === "week") {
    return `${format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd")} ~ ${format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd")}`;
  }
  return `${format(startOfMonth(now), "yyyy-MM-dd")} ~ ${format(endOfMonth(now), "yyyy-MM-dd")}`;
}

function renderStats() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Stats />
    </QueryClientProvider>,
  );
}

function emptyStats(cmd: string) {
  switch (cmd) {
    case "stats_plan_vs_actual":
    case "stats_method_share":
    case "stats_tag_type_totals":
    case "stats_avg_ratings":
      return [];
    case "stats_completion_rate":
      return { done: 0, missed: 0, rescheduled: 0, rate: 0 };
    default:
      return null;
  }
}

const todaySession: TaskSession = {
  ...session,
  id: 7,
  date: "2026-01-01",
  task_title: "函数专项",
  subject: "数学",
};

const userStats: UserStats = {
  id: 1,
  total_xp: 100,
  current_level: 2,
  current_streak: 4,
  longest_streak: 9,
  last_done_date: "2025-12-31",
};

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function invokeCount(cmd: string): number {
  return mockedInvoke.mock.calls.filter((call) => call[0] === cmd).length;
}

function streakLine(): string {
  const label = screen.getByText((_, el) => el?.textContent === "连击 ");
  return label.parentElement?.textContent ?? "";
}

describe("exam date isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    seedPrimary(EXAM_A);
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exam_date_change_does_not_shift_open_complete_dialog_date", () => {
    freezeLocalNoon(2026, 5, 3);
    const today = todayStr();
    expect(today).toBe("2026-06-03");

    renderCompleteDialog();

    fireEvent.change(screen.getByLabelText(/实际课数/), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /剩余.*改到下次/ }));

    const dateInput = deferDateInput();
    expect(dateInput.value).toBe(today);
    expect(dateInput.value).not.toBe(session.date);
    expect(dateInput.value).not.toBe(EXAM_A);

    act(() => {
      seedPrimary(EXAM_B);
    });

    expect(deferDateInput().value).toBe(today);

    fireEvent.change(deferDateInput(), { target: { value: USER_PICKED } });
    expect(deferDateInput().value).toBe(USER_PICKED);

    act(() => {
      seedPrimary(EXAM_C);
    });

    expect(deferDateInput().value).toBe(USER_PICKED);
    expect(useUiStore.getState().exams.find((e) => e.isPrimary)?.date).toBe(EXAM_C);
  });

  it("exam_date_change_does_not_shift_open_stats_range", async () => {
    freezeLocalNoon(2026, 5, 3);
    const week = rangeFor("week");
    const month = rangeFor("month");
    expect(week).toBe("2026-06-01 ~ 2026-06-07");
    expect(month).toBe("2026-06-01 ~ 2026-06-30");
    expect(week).not.toContain("2026-07-01");

    mockedInvoke.mockImplementation(async (cmd: string) => emptyStats(cmd));
    renderStats();

    await waitFor(() => {
      expect(screen.getByText(week)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "本周" })).toBeInTheDocument();

    act(() => {
      seedPrimary(EXAM_B);
    });

    expect(screen.getByText(week)).toBeInTheDocument();
    expect(screen.queryByText(/2026-07-01/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "本月" }));
    expect(screen.getByText(month)).toBeInTheDocument();
    expect(screen.queryByText(week)).not.toBeInTheDocument();

    act(() => {
      seedPrimary(EXAM_C);
    });

    expect(screen.getByText(month)).toBeInTheDocument();
    const ranges = mockedInvoke.mock.calls
      .filter((call) => String(call[0]).startsWith("stats_"))
      .map((call) => call[1] as { from?: string; to?: string });
    expect(ranges.length).toBeGreaterThan(0);
    for (const range of ranges) {
      expect(range.from === EXAM_B || range.to === EXAM_B).toBe(false);
      expect(range.from === EXAM_C || range.to === EXAM_C).toBe(false);
    }
  });

  it("exam_date_change_only_affects_countdown", async () => {
    freezeLocalNoon(2026, 0, 1);
    const daysA = String(computeCountdown(EXAM_A, new Date()).days);
    const daysB = String(computeCountdown(EXAM_B, new Date()).days);
    expect(daysA).not.toBe(daysB);

    let seq = 0;
    vi.spyOn(window, "setInterval").mockImplementation(() => {
      seq += 1;
      return seq as unknown as ReturnType<typeof setInterval>;
    });
    vi.spyOn(window, "clearInterval").mockImplementation(() => {});

    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_sessions_by_date") return [todaySession];
      if (cmd === "get_user_stats") return userStats;
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("函数专项")).toBeInTheDocument();
      expect(screen.getByText("Lv.2")).toBeInTheDocument();
    });
    expect(screen.getByText(daysA)).toBeInTheDocument();
    expect(screen.getByText(`目标日 ${EXAM_A}`)).toBeInTheDocument();
    expect(streakLine()).toBe("连击 4 天 · 最长 9");
    expect(screen.queryByText("今日暂无待完成排期。")).not.toBeInTheDocument();

    const sessionCalls = invokeCount("list_sessions_by_date");
    const statsCalls = invokeCount("get_user_stats");
    expect(sessionCalls).toBeGreaterThan(0);
    expect(statsCalls).toBeGreaterThan(0);
    const sessionDates = mockedInvoke.mock.calls
      .filter((call) => call[0] === "list_sessions_by_date")
      .map((call) => (call[1] as { date: string }).date);
    expect(sessionDates.every((date) => date === "2026-01-01")).toBe(true);

    act(() => {
      seedPrimary(EXAM_B);
    });

    expect(screen.getByText(daysB)).toBeInTheDocument();
    expect(screen.queryByText(daysA)).not.toBeInTheDocument();
    expect(screen.getByText(`目标日 ${EXAM_B}`)).toBeInTheDocument();
    expect(screen.getByText("函数专项")).toBeInTheDocument();
    expect(screen.getByText("Lv.2")).toBeInTheDocument();
    expect(streakLine()).toBe("连击 4 天 · 最长 9");
    expect(screen.queryByText("今日暂无待完成排期。")).not.toBeInTheDocument();
    expect(invokeCount("list_sessions_by_date")).toBe(sessionCalls);
    expect(invokeCount("get_user_stats")).toBe(statsCalls);
  });
});
