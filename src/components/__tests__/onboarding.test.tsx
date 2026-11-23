import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_PROFILE } from "../../lib/profile";
import type { Goal, UpsertGoalPayload, UserProfile } from "../../types";
import { ONBOARDING_KEY, OnboardingGate } from "../Onboarding";

const mockedInvoke = vi.mocked(invoke);

function renderGate() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OnboardingGate />
    </QueryClientProvider>,
  );
}

describe("Onboarding", () => {
  let completed = false;
  const calls: string[] = [];
  let saved: UserProfile | null = null;
  let goals: Goal[] = [];

  beforeEach(() => {
    completed = false;
    saved = null;
    calls.length = 0;
    goals = [
      {
        id: 1,
        trackId: null,
        name: "高考",
        date: "2027-06-07",
        kind: "exam",
        isPrimary: true,
        targetScore: null,
        createdAt: "2026-11-06 12:00:00",
      },
    ];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0));
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_setting") {
        const key = (args as { key?: string } | undefined)?.key;
        if (key === ONBOARDING_KEY) return completed ? "1" : null;
        return null;
      }
      if (cmd === "get_user_profile") return saved ?? DEFAULT_USER_PROFILE;
      if (cmd === "update_user_profile") {
        calls.push(cmd);
        saved = (args as { profile: UserProfile }).profile;
        return saved;
      }
      if (cmd === "list_goals") return goals;
      if (cmd === "upsert_goal") {
        const payload = (args as { payload: UpsertGoalPayload }).payload;
        const existing =
          payload.id != null ? goals.find((goal) => goal.id === payload.id) : undefined;
        const next: Goal = existing
          ? {
              ...existing,
              name: payload.name,
              date: payload.date,
              kind: payload.kind ?? existing.kind,
              isPrimary: payload.isPrimary ?? existing.isPrimary,
            }
          : {
              id: goals.reduce((max, goal) => Math.max(max, goal.id), 0) + 1,
              trackId: null,
              name: payload.name,
              date: payload.date,
              kind: payload.kind ?? "exam",
              isPrimary: payload.isPrimary ?? false,
              targetScore: null,
              createdAt: "2026-11-06 12:00:00",
            };
        goals = existing
          ? goals.map((goal) => (goal.id === next.id ? next : goal))
          : [...goals, next];
        return next;
      }
      if (cmd === "set_setting") {
        calls.push(cmd);
        const payload = args as { key?: string; value?: string };
        if (payload.key === ONBOARDING_KEY) completed = payload.value === "1";
        return null;
      }
      if (cmd === "generate_mock_data") {
        calls.push(cmd);
        return null;
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function reachStepTwo() {
    renderGate();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "开始之前" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "高一" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "高二" }));
    fireEvent.change(screen.getByLabelText("地区"), { target: { value: "湖南" } });
    fireEvent.change(screen.getByLabelText("高考目标分"), { target: { value: "650" } });
    expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByRole("button", { name: "开启真实记录（推荐）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加载湖南高二演示数据" })).toBeInTheDocument();
    expect(screen.getByText(/高考日 2028-06-07/)).toBeInTheDocument();
  }

  it("onboarding_real_start_saves_profile_and_skips_mock", async () => {
    await reachStepTwo();
    fireEvent.click(screen.getByRole("button", { name: "开启真实记录（推荐）" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(calls).toEqual(["update_user_profile", "set_setting"]);
    expect(saved).toMatchObject({
      grade: "高二",
      region: "湖南",
      total_target: 650,
    });
    expect(goals.find((goal) => goal.isPrimary)?.date).toBe("2028-06-07");
  });

  it("onboarding_loads_hunan_demo_data", async () => {
    await reachStepTwo();
    fireEvent.click(screen.getByRole("button", { name: "加载湖南高二演示数据" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(calls).toEqual(["update_user_profile", "generate_mock_data", "set_setting"]);
    expect(saved?.grade).toBe("高二");
    expect(saved?.region).toBe("湖南");
    expect(goals.find((goal) => goal.isPrimary)?.date).toBe("2028-06-07");
  });

  it("onboarding_hides_when_already_completed", async () => {
    completed = true;
    renderGate();
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "get_setting",
        expect.objectContaining({ key: ONBOARDING_KEY }),
      );
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "开始之前" })).not.toBeInTheDocument();
  });
});
