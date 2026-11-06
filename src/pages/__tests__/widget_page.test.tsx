import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { computeCountdown } from "../../lib/date";
import { useUiStore } from "../../store/ui";
import type { TaskSession } from "../../types";
import { WidgetPage } from "../WidgetPage";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "widget",
    setAlwaysOnTop: vi.fn(async () => undefined),
    hide: vi.fn(async () => undefined),
  }),
}));

const mockedInvoke = vi.mocked(invoke);
const EXAM_DATE = "2027-06-07";

const activeSession: TaskSession = {
  id: 7,
  task_id: 1,
  date: "2026-11-06",
  start_time: "00:00",
  end_time: "23:59",
  round: 1,
  status: "planned",
  planned_units: 2,
  actual_units: 0,
  self_rating: null,
  self_note: null,
  rescheduled_to: null,
  xp_awarded: 0,
  created_at: "2026-11-06 00:00:00",
  task_title: "函数专项",
  task_type: "main",
};

function renderWidget() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WidgetPage />
    </QueryClientProvider>,
  );
}

describe("WidgetPage", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().setExams([
      { id: "gaokao", name: "高考", date: EXAM_DATE, isPrimary: true },
    ]);
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_sessions_by_date") return [activeSession];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("widget-window");
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it("widget_page_renders_countdown", async () => {
    renderWidget();

    const days = String(computeCountdown(EXAM_DATE, new Date()).days);
    expect(screen.getByTestId("widget-countdown-days").textContent).toContain(days);
    expect(screen.getByText("天")).toBeInTheDocument();
    expect(screen.getByText("距离 高考")).toBeInTheDocument();
    expect(document.querySelector("[data-tauri-drag-region]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "关闭悬浮窗" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("进行中")).toBeInTheDocument();
    });
    expect(screen.getByText("函数专项")).toBeInTheDocument();
    expect(screen.getByText("00:00–23:59")).toBeInTheDocument();
  });

  it("widget_label_skips_main_shell", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    render(<App />);

    expect(document.documentElement.classList.contains("widget-window")).toBe(true);
    expect(screen.getByTestId("widget-countdown-days")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText("今日排期")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "桌面悬浮窗" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("进行中")).toBeInTheDocument();
    });
  });
});
