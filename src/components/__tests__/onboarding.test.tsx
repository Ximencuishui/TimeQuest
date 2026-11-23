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
              targetScore: payload.targetScore ?? existing.targetScore,
            }
          : {
              id: goals.reduce((max, goal) => Math.max(max, goal.id), 0) + 1,
              trackId: null,
              name: payload.name,
              date: payload.date,
              kind: payload.kind ?? "exam",
              isPrimary: payload.isPrimary ?? false,
              targetScore: payload.targetScore ?? null,
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

  /** 第 1 步选方向 → 第 2 步填目标 → 第 3 步确认。 */
  async function reachStepThree() {
    renderGate();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "你在为什么努力" })).toBeInTheDocument();
    });
    // 方向卡片：高考 / 考研 / 语言学习 / 技能习得 / 自定义
    expect(screen.getByRole("button", { name: /高考/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /考研/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /语言学习/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /技能习得/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /自定义/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByRole("heading", { name: "定下目标" })).toBeInTheDocument();
    expect(screen.getByLabelText("目标名称")).toHaveValue("高考");
    // 六科默认值不变
    expect(screen.getByLabelText("语文")).toHaveValue("120");
    expect(screen.getByLabelText("数学")).toHaveValue("130");
    expect(screen.getByLabelText("英语")).toHaveValue("120");
    expect(screen.getByLabelText("物理")).toHaveValue("80");
    expect(screen.getByLabelText("化学")).toHaveValue("80");
    expect(screen.getByLabelText("生物")).toHaveValue("80");

    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "高二" }));
    fireEvent.change(screen.getByLabelText("地区"), { target: { value: "湖南" } });
    fireEvent.change(screen.getByLabelText("总分目标"), { target: { value: "650" } });
    expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByRole("button", { name: "开启真实记录（推荐）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加载湖南高二演示数据" })).toBeInTheDocument();
  }

  it("onboarding_real_start_saves_profile_and_skips_mock", async () => {
    await reachStepThree();
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
    expect(mockedInvoke).toHaveBeenCalledWith(
      "upsert_goal",
      expect.objectContaining({
        payload: expect.objectContaining({ date: "2028-06-07", name: "高考" }),
      }),
    );
  });

  it("onboarding_loads_hunan_demo_data", async () => {
    await reachStepThree();
    fireEvent.click(screen.getByRole("button", { name: "加载湖南高二演示数据" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(calls).toEqual(["update_user_profile", "generate_mock_data", "set_setting"]);
    expect(saved?.grade).toBe("高二");
    expect(saved?.region).toBe("湖南");
    expect(goals.find((goal) => goal.isPrimary)?.date).toBe("2028-06-07");
  });

  it("onboarding_placeholder_track_falls_back_to_custom", async () => {
    renderGate();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "你在为什么努力" })).toBeInTheDocument();
    });

    // 考研还没落地，选中后按「自定义」分支走。
    fireEvent.click(screen.getByRole("button", { name: /考研/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByRole("heading", { name: "定下目标" })).toBeInTheDocument();
    expect(screen.getByLabelText("目标名称")).toHaveValue("我的目标");
    // 自定义赛道不问年级 / 地区，也没有科目清单。
    expect(screen.queryByRole("button", { name: "高二" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("地区")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("语文")).not.toBeInTheDocument();
    // 不计总分，满分上限不写死。
    expect(screen.getByLabelText("总分目标")).toHaveAttribute("placeholder", "可留空");
  });

  it("onboarding_custom_track_has_no_subjects", async () => {
    renderGate();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "你在为什么努力" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /自定义/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByLabelText("目标名称")).toHaveValue("我的目标");
    expect(screen.queryByRole("button", { name: "高二" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("地区")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("语文")).not.toBeInTheDocument();
  });

  it("onboarding_target_score_has_no_hardcoded_750_limit", async () => {
    renderGate();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "你在为什么努力" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    // 高考模板的满分上限来自模板本身（750），不是写死的常量。
    expect(screen.getByLabelText("总分目标")).toHaveAttribute("placeholder", "1–750");
    fireEvent.change(screen.getByLabelText("地区"), { target: { value: "湖南" } });
    fireEvent.change(screen.getByLabelText("总分目标"), { target: { value: "800" } });
    expect(screen.getByText(/总分目标需要是 1 到 750 的整数/)).toBeInTheDocument();
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
    expect(screen.queryByRole("heading", { name: "你在为什么努力" })).not.toBeInTheDocument();
  });
});
