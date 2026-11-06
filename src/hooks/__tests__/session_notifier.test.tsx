import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isTauri, invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREP_NOTICE_BODY } from "../../lib/sessionNotices";
import { useUiStore } from "../../store/ui";
import type { TaskSession } from "../../types";
import { useSessionNotifier } from "../useSessionNotifier";

const mockedInvoke = vi.mocked(invoke);
const mockedSend = vi.mocked(sendNotification);
const mockedPermission = vi.mocked(isPermissionGranted);
const mockedRequest = vi.mocked(requestPermission);

const PREP_BODY = "【准备】距离下一场学习还有 5 分钟，准备进入状态。";
const START_BODY = "【开始】该学【函数专项】了，冲！";

const session: TaskSession = {
  id: 9,
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
  task_title: "函数专项",
  task_type: "main",
};

function Host() {
  useSessionNotifier();
  return null;
}

function renderHost() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );
}

function bodies(): string[] {
  return mockedSend.mock.calls.map((call) => {
    const options = call[0];
    return typeof options === "string" ? options : (options.body ?? "");
  });
}

describe("useSessionNotifier", () => {
  const ticks: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 6, 8, 55, 0));
    localStorage.clear();
    useUiStore.getState().setNotificationsEnabled(true);
    vi.mocked(isTauri).mockReturnValue(true);
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_sessions_by_date") return [session];
      return null;
    });
    mockedSend.mockReset();
    mockedPermission.mockReset();
    mockedPermission.mockResolvedValue(true);
    mockedRequest.mockReset();
    mockedRequest.mockResolvedValue("granted");
    ticks.length = 0;
    const realSetInterval = window.setInterval.bind(window);
    const realClearInterval = window.clearInterval.bind(window);
    vi.spyOn(window, "setInterval").mockImplementation((handler, timeout, ...args) => {
      if (timeout === 60_000) {
        ticks.push(handler as () => void);
        return 987654 as unknown as NodeJS.Timeout;
      }
      return realSetInterval(handler as TimerHandler, timeout, ...args) as unknown as NodeJS.Timeout;
    });
    vi.spyOn(window, "clearInterval").mockImplementation((id) => {
      if (id === 987654) return;
      realClearInterval(id as number);
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(isTauri).mockReturnValue(false);
  });

  async function advanceTo(hour: number, minute: number) {
    vi.setSystemTime(new Date(2026, 10, 6, hour, minute, 0));
    await act(async () => {
      for (const tick of ticks) tick();
    });
  }

  it("session_notifier_fires_prep_then_start_once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHost();

    await waitFor(() => {
      expect(bodies()).toEqual([PREP_BODY]);
    });
    expect(PREP_BODY).toBe(PREP_NOTICE_BODY);
    expect(mockedSend).toHaveBeenCalledWith(
      expect.objectContaining({ title: "TimeQuest", body: PREP_BODY }),
    );

    await advanceTo(9, 0);
    await waitFor(() => {
      expect(bodies()).toEqual([PREP_BODY, START_BODY]);
    });

    await advanceTo(9, 1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(bodies()).toEqual([PREP_BODY, START_BODY]);
    expect(error).not.toHaveBeenCalled();
  });

  it("session_notifier_stays_quiet_when_disabled_or_permission_denied", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    useUiStore.getState().setNotificationsEnabled(false);
    const disabled = renderHost();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedSend).not.toHaveBeenCalled();
    expect(mockedPermission).not.toHaveBeenCalled();
    disabled.unmount();

    useUiStore.getState().setNotificationsEnabled(true);
    mockedPermission.mockResolvedValue(false);
    mockedRequest.mockResolvedValue("denied");
    renderHost();
    await waitFor(() => {
      expect(mockedPermission).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedSend).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
