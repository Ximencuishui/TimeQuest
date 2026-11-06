import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../../store/ui";
import { CountdownPanel } from "../CountdownPanel";

const { todaySessions } = vi.hoisted(() => ({
  todaySessions: [] as {
    status: string;
    start_time: string;
    end_time: string;
    task_title?: string;
  }[],
}));

vi.mock("../../hooks/useSessions", () => ({
  useSessionsByDate: () => ({ data: todaySessions, isLoading: false }),
}));

/** C 段确认：`useEffect` 内 `window.setInterval(..., 1000)`，清理在 effect return；依赖见组件。 */

function seedPrimary(date: string, name = "高考") {
  useUiStore.getState().setExams([
    { id: "gaokao", name, date, isPrimary: true },
  ]);
}

function clockText(): string {
  const el = document.querySelector("[data-testid='today-remaining-clock']");
  if (!el) throw new Error("countdown clock not found");
  return (el.textContent ?? "").trim();
}

function MountGate({ show }: { show: boolean }) {
  return show ? <CountdownPanel /> : null;
}

describe("CountdownPanel interval lifecycle", () => {
  beforeEach(() => {
    todaySessions.splice(0, todaySessions.length);
    seedPrimary("2027-06-07");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T12:00:30"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("countdown_panel_does_not_tick_after_unmount", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    todaySessions.push({ status: "planned", start_time: "11:00", end_time: "13:00", task_title: "英语" });

    const { rerender } = render(<MountGate show />);

    const before = clockText();
    expect(before).toMatch(/\d{2}:\d{2}:\d{2}/);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    const afterTick = clockText();
    expect(afterTick).not.toBe(before);

    rerender(<MountGate show={false} />);
    expect(screen.queryByText(/\d{2}:\d{2}:\d{2}/)).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    const unmountedNoise = consoleError.mock.calls.filter(([msg]) =>
      /unmounted|not mounted|Can't perform a React state update/i.test(String(msg)),
    );
    expect(unmountedNoise).toEqual([]);
  });

  it("countdown_panel_clears_interval_on_unmount", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    const { unmount } = render(<CountdownPanel />);

    // C 段：空依赖时 mount 只创建一次；若依赖含 target，仍至少一次。
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(setIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    // Fake timers 返回 Timer 对象，不必是 number；只要求 clear 收到同一句柄。
    const firstId = setIntervalSpy.mock.results[0]?.value;
    expect(firstId).toBeDefined();

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    const clearedIds = clearIntervalSpy.mock.calls.map((c) => c[0]);
    expect(clearedIds).toContain(firstId);
  });

  it("countdown_panel_updates_days_without_restarting_the_clock", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    seedPrimary("2027-06-07", "高考");
    render(<CountdownPanel />);

    expect(screen.getByText("目标日 2027-06-07")).toBeInTheDocument();
    const daysBefore = document.querySelector(".text-accent-soft")?.textContent;
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const oldId = setIntervalSpy.mock.results[0]?.value;

    await act(async () => {
      seedPrimary("2028-06-07", "高考");
    });

    expect(screen.getByText("目标日 2028-06-07")).toBeInTheDocument();
    const daysAfter = document.querySelector(".text-accent-soft")?.textContent;
    expect(daysAfter).toBeDefined();
    expect(daysAfter).not.toBe(daysBefore);

    // 墙钟 interval 不跟目标日走，换日期不能再开一条。
    expect(clearIntervalSpy).not.toHaveBeenCalled();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.results[0]?.value).toBe(oldId);
  });

  it("countdown_panel_past_target_shows_arrived_not_negative", () => {
    vi.setSystemTime(new Date("2026-06-08T12:00:00"));
    seedPrimary("2026-06-07T09:00:00");
    render(<CountdownPanel />);

    const text = document.body.textContent ?? "";
    expect(text).toContain("已到达");
    expect(screen.getByTestId("today-remaining")).toHaveTextContent("今日任务全部完成");
    assertNoNegativeOrGarbage(text);

    cleanup();
    vi.useRealTimers();
  });

  it("countdown_panel_transitions_to_arrived_at_target_moment", async () => {
    // 锚点是目标日本地零点。零点前 1.5 秒大字仍是天数；
    // 下一次 1 秒 tick 落在零点前 0.5 秒，直接变成「已到达」。
    seedPrimary("2026-06-11");
    vi.setSystemTime(new Date("2026-06-10T23:59:58.500"));
    render(<CountdownPanel />);

    expect(screen.getByTestId("today-remaining")).toHaveTextContent("今日任务全部完成");
    expect(headlineText()).not.toBe("");
    expect(screen.queryByText("已到达")).not.toBeInTheDocument();
    assertNoNegativeOrGarbage(document.body.textContent ?? "");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    const text = document.body.textContent ?? "";
    expect(text.trim()).not.toBe("");
    expect(headlineText()).toBe("已到达");
    expect(screen.getByTestId("today-remaining")).toHaveTextContent("今日任务全部完成");
    expect(document.querySelector(".text-accent-soft")).not.toBeInTheDocument();
    assertNoNegativeOrGarbage(text);
  });

  it("countdown_panel_recomputes_when_target_changes_to_past", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    seedPrimary("2027-06-07");
    const { rerender } = render(<CountdownPanel />);

    const days = Number(document.querySelector(".text-accent-soft")?.textContent);
    expect(days).toBeGreaterThan(0);

    await act(async () => {
      seedPrimary("2026-06-07");
    });
    rerender(<CountdownPanel />);

    expect(screen.getByText("已到达")).toBeInTheDocument();
    expect(document.querySelector(".text-accent-soft")).not.toBeInTheDocument();
    expect(screen.queryByText(String(days))).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("countdown_panel_past_target_hides_day_field_if_design_requires", () => {
    vi.setSystemTime(new Date("2026-06-08T12:00:00"));
    seedPrimary("2026-06-07");
    render(<CountdownPanel />);

    expect(screen.getByText("已到达")).toBeInTheDocument();
    expect(screen.getByTestId("today-remaining")).toHaveTextContent("今日任务全部完成");
    expect(screen.queryByText("天")).not.toBeInTheDocument();
    expect(screen.getByText("0 周")).toBeInTheDocument();
    expect(screen.getByText("0 月")).toBeInTheDocument();
  });
});

function headlineText(): string {
  return document.querySelector(".text-5xl")?.textContent?.trim() ?? "";
}

function assertNoNegativeOrGarbage(text: string) {
  const withoutDates = text.replace(/\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?)?/g, "");
  expect(withoutDates).not.toMatch(/-\d+/);
  expect(text).not.toContain("NaN");
  expect(text).not.toContain("Invalid Date");
}
