import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gridRange } from "../../../lib/calendar";
import { Today } from "../../Today";

const mockedInvoke = vi.mocked(invoke);

function rangeCalls(): { startDate: string; endDate: string }[] {
  return mockedInvoke.mock.calls
    .filter((call) => call[0] === "list_sessions_in_range")
    .map((call) => call[1] as { startDate: string; endDate: string });
}

function renderToday() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <Today />
    </QueryClientProvider>,
  );
}

describe("Today calendar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0));
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_sessions_in_range") return [];
      if (cmd === "list_sessions_by_date") return [];
      if (cmd === "list_tasks") return [];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("refetches the visible grid when the next month is opened", async () => {
    renderToday();
    expect(screen.getByRole("heading", { name: "今日计划" })).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-view")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "日历视图" }));
    expect(screen.getByTestId("calendar-view")).toBeInTheDocument();

    const november = gridRange(new Date(2026, 10, 1));
    await waitFor(() => {
      expect(rangeCalls()).toEqual([
        { startDate: november.start, endDate: november.end },
      ]);
    });
    expect(november).toEqual({ start: "2026-10-26", end: "2026-12-06" });
    expect(screen.getByTestId("calendar-month-label")).toHaveTextContent(
      "2026年 11月",
    );

    const before = rangeCalls().length;
    fireEvent.click(screen.getByRole("button", { name: "下个月" }));

    const december = gridRange(new Date(2026, 11, 1));
    await waitFor(() => {
      expect(rangeCalls().length).toBeGreaterThan(before);
      expect(rangeCalls()[rangeCalls().length - 1]).toEqual({
        startDate: december.start,
        endDate: december.end,
      });
    });
    expect(december).toEqual({ start: "2026-11-30", end: "2027-01-03" });
    expect(screen.getByTestId("calendar-month-label")).toHaveTextContent(
      "2026年 12月",
    );
  });
});
