import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeCountdown } from "../../../lib/date";
import { useUiStore } from "../../../store/ui";
import { Dashboard } from "../../Dashboard.tsx";

/**
 * D 段：CountdownPanel 用 useUiStore 的 exams，不在挂载时读 localStorage。
 * store 没有 setExamDate；设置页和这里都走 setExams / upsertExam。
 * localStorage 键是 timequest.exams，只在 store 创建时由 loadExams() 读一次。
 * 重新挂载仍看当前 store，不会单独把磁盘上的旧值再读进来。
 */

const mockedInvoke = vi.mocked(invoke);
const DATE_A = "2026-06-07";
const DATE_B = "2026-07-01";

function seedPrimary(date: string) {
  useUiStore.getState().setExams([
    { id: "gaokao", name: "高考", date, isPrimary: true },
  ]);
}

function daysFor(date: string): string {
  return String(computeCountdown(date, new Date()).days);
}

function daysText(): string {
  const el = document.querySelector(".text-accent-soft");
  if (!el) throw new Error("countdown days not found");
  return (el.textContent ?? "").trim();
}

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

describe("Dashboard countdown store sync", () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;
  let clearIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    localStorage.clear();
    seedPrimary(DATE_A);
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_sessions_by_date") return [];
      if (cmd === "list_tasks") return [];
      return null;
    });
    let seq = 0;
    setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation(() => {
      seq += 1;
      return seq as unknown as ReturnType<typeof setInterval>;
    });
    clearIntervalSpy = vi.spyOn(window, "clearInterval").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("dashboard_countdown_updates_when_exam_date_changes_in_store", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    renderDashboard();

    expect(screen.getByText(`目标日 ${DATE_A}`)).toBeInTheDocument();
    expect(daysText()).toBe(daysFor(DATE_A));
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const oldId = setIntervalSpy.mock.results[0]?.value;
    expect(oldId).toBeDefined();

    act(() => {
      seedPrimary(DATE_B);
    });

    expect(screen.getByText(`目标日 ${DATE_B}`)).toBeInTheDocument();
    expect(daysText()).toBe(daysFor(DATE_B));
    expect(daysText()).not.toBe(daysFor(DATE_A));
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.results[0]?.value).toBe(oldId);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("dashboard_countdown_does_not_use_stale_date_after_remount", () => {
    const { unmount } = renderDashboard();

    expect(screen.getByText(`目标日 ${DATE_A}`)).toBeInTheDocument();
    const daysA = daysText();
    expect(daysA).toBe(daysFor(DATE_A));

    act(() => {
      useUiStore.getState().upsertExam({
        id: "gaokao",
        name: "高考",
        date: DATE_B,
        isPrimary: true,
      });
    });

    const idBeforeUnmount = setIntervalSpy.mock.results.at(-1)?.value;
    expect(idBeforeUnmount).toBeDefined();
    unmount();
    expect(clearIntervalSpy.mock.calls.map((call: Parameters<typeof window.clearInterval>) => call[0])).toContain(idBeforeUnmount);

    const intervalsBeforeRemount = setIntervalSpy.mock.calls.length;
    renderDashboard();

    expect(screen.getByText(`目标日 ${DATE_B}`)).toBeInTheDocument();
    expect(screen.queryByText(`目标日 ${DATE_A}`)).not.toBeInTheDocument();
    expect(daysText()).toBe(daysFor(DATE_B));
    expect(daysText()).not.toBe(daysA);
    expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(intervalsBeforeRemount);
  });
});
