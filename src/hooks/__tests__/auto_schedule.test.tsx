import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoSchedule } from "../useAutoSchedule";

const mockedInvoke = vi.mocked(invoke);

function Host() {
  useAutoSchedule();
  return null;
}

function renderHost() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );
  return { invalidate, ...view };
}

function autoScheduleCalls(): number {
  return mockedInvoke.mock.calls.filter(
    (call) => call[0] === "ensure_today_schedule",
  ).length;
}

describe("useAutoSchedule", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "ensure_today_schedule") {
        return { date: "2026-11-21", created: 0, skipped: 0, taskIds: [] };
      }
      return null;
    });
    vi.mocked(isTauri).mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it("auto_schedule_fills_today_and_refreshes_sessions", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "ensure_today_schedule") {
        return { date: "2026-11-21", created: 3, skipped: 0, taskIds: [4, 5] };
      }
      return null;
    });

    const { invalidate } = renderHost();

    await waitFor(() => {
      expect(autoScheduleCalls()).toBe(1);
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["sessions"] });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["sessions-range"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["sessions-task"] });
  });

  it("auto_schedule_stays_quiet_when_nothing_was_created", async () => {
    const { invalidate } = renderHost();

    await waitFor(() => {
      expect(autoScheduleCalls()).toBe(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("auto_schedule_does_not_run_outside_tauri", async () => {
    vi.mocked(isTauri).mockReturnValue(false);

    renderHost();

    await act(async () => {
      await Promise.resolve();
    });
    expect(autoScheduleCalls()).toBe(0);
  });

  it("auto_schedule_swallows_backend_errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "ensure_today_schedule") throw new Error("boom");
      return null;
    });

    const { invalidate } = renderHost();

    await waitFor(() => {
      expect(autoScheduleCalls()).toBe(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(warn).toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
