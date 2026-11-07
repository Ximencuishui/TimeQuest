import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CelebrationHost } from "../../components/CelebrationHost";
import { useSessionMutations } from "../useSessions";
import { useCelebrationStore } from "../../lib/celebration";
import type { CompleteSessionResult, TaskSession } from "../../types";

vi.mock("canvas-confetti", () => ({
  default: vi.fn(() => Promise.resolve()),
}));

import confetti from "canvas-confetti";

const mockedInvoke = vi.mocked(invoke);
const mockedConfetti = vi.mocked(confetti);

const session: TaskSession = {
  id: 1,
  task_id: 4,
  date: "2026-11-07",
  start_time: "19:00",
  end_time: "20:00",
  round: 1,
  status: "done",
  planned_units: 4,
  actual_units: 4,
  self_rating: 5,
  self_note: null,
  rescheduled_to: null,
  xp_awarded: 10,
  created_at: "2026-11-07 19:00:00",
  task_title: "数学必修一",
  task_type: "main",
  subject: "数学",
};

function result(
  partial: Partial<CompleteSessionResult> = {},
): CompleteSessionResult {
  return {
    session,
    xpAwarded: 10,
    newAchievements: [],
    createdSessionId: null,
    remainderSessionId: null,
    isTaskFullyCompleted: false,
    currentStreak: 1,
    streakMilestone: null,
    ...partial,
  };
}

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  createOscillator() {
    return {
      type: "triangle",
      frequency: { value: 0 },
      connect() {},
      start() {},
      stop() {},
    };
  }
  createGain() {
    return {
      gain: {
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
      connect() {},
    };
  }
  close() {
    return Promise.resolve();
  }
}

const audioContexts: FakeAudioContext[] = [];

function Probe() {
  const { complete } = useSessionMutations();
  return (
    <>
      <CelebrationHost />
      <button
        type="button"
        onClick={() =>
          complete.mutate({
            sessionId: 1,
            actualUnits: 4,
            selfRating: 5,
          })
        }
      >
        完成这场
      </button>
    </>
  );
}

function renderProbe(setting: string | null, payload: CompleteSessionResult) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "get_setting") return setting;
    if (cmd === "complete_session") return payload;
    return null;
  });
  const view = render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

async function settleSetting(client: QueryClient) {
  await waitFor(() => {
    expect(
      client.getQueryState(["appSetting", "enable_celebrations"])?.status,
    ).toBe("success");
  });
}

describe("useCelebration", () => {
  beforeEach(() => {
    audioContexts.length = 0;
    mockedConfetti.mockClear();
    useCelebrationStore.setState({ message: null, token: 0 });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
      onchange: null,
    }));
    vi.stubGlobal(
      "AudioContext",
      class extends FakeAudioContext {
        constructor() {
          super();
          audioContexts.push(this);
        }
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useCelebrationStore.setState({ message: null, token: 0 });
  });

  it("celebrate_task_complete_fires_confetti_when_setting_unset", async () => {
    const { client } = renderProbe(null, result({ isTaskFullyCompleted: true }));
    await settleSetting(client);
    fireEvent.click(screen.getByRole("button", { name: "完成这场" }));

    expect(
      await screen.findByRole("status"),
    ).toHaveTextContent("🎉 恭喜通关《数学必修一》！你的城堡又高了一层！");
    await waitFor(() => {
      expect(mockedConfetti).toHaveBeenCalledTimes(3);
    });
    expect(audioContexts.length).toBe(1);
    expect(screen.getByTestId("celebration-overlay")).toHaveClass(
      "pointer-events-none",
    );
  });

  it("celebrate_streak_milestone_fires_once", async () => {
    const { client } = renderProbe(
      "1",
      result({ currentStreak: 7, streakMilestone: 7 }),
    );
    await settleSetting(client);
    fireEvent.click(screen.getByRole("button", { name: "完成这场" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "🔥 连击 7 天达成！你已经击败了全国 90% 的考生！",
    );
    await waitFor(() => {
      expect(mockedConfetti).toHaveBeenCalledTimes(1);
    });
  });

  it("celebrations_disabled_skips_confetti_sound_and_overlay", async () => {
    const { client } = renderProbe(
      "0",
      result({ isTaskFullyCompleted: true, streakMilestone: 7, currentStreak: 7 }),
    );
    await settleSetting(client);
    fireEvent.click(screen.getByRole("button", { name: "完成这场" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "complete_session",
        expect.anything(),
      );
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mockedConfetti).not.toHaveBeenCalled();
    expect(audioContexts.length).toBe(0);
  });
});

describe("CelebrationHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useCelebrationStore.setState({ message: null, token: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useCelebrationStore.setState({ message: null, token: 0 });
  });

  it("celebration_overlay_fades_after_two_seconds_and_ignores_pointer", () => {
    useCelebrationStore
      .getState()
      .show("🎉 恭喜通关《数学必修一》！你的城堡又高了一层！");
    render(<CelebrationHost />);

    const overlay = screen.getByTestId("celebration-overlay");
    expect(overlay).toHaveClass("pointer-events-none");
    expect(overlay).toHaveAttribute("data-state", "visible");
    expect(overlay).toHaveTextContent("数学必修一");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId("celebration-overlay")).toHaveAttribute(
      "data-state",
      "fading",
    );

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByTestId("celebration-overlay")).not.toBeInTheDocument();
  });
});
