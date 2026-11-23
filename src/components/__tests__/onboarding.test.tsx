import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_PROFILE } from "../../lib/profile";
import { SUBJECT_FIXTURES } from "../../test/subjectFixtures";
import type {
  Goal,
  PluginInfo,
  UpsertGoalPayload,
  UpsertSubjectPayload,
  UserProfile,
} from "../../types";
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
  let plugins: PluginInfo[] = [];

  beforeEach(() => {
    completed = false;
    saved = null;
    calls.length = 0;
    plugins = [];
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
      if (cmd === "list_plugins") return plugins;
      if (cmd === "list_subjects") return SUBJECT_FIXTURES;
      if (cmd === "upsert_subject") {
        const payload = (args as { payload: UpsertSubjectPayload }).payload;
        return { ...payload, id: payload.id ?? 0 };
      }
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
    // 4.0 起各科目标写进 `subjects` 表，不再塞进档案。
    expect(mockedInvoke).toHaveBeenCalledWith(
      "upsert_subject",
      expect.objectContaining({
        payload: expect.objectContaining({ key: "math", goal: 130 }),
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

  it("onboarding_kaoyan_track_uses_its_own_subjects", async () => {
    renderGate();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "你在为什么努力" })).toBeInTheDocument();
    });

    // 考研赛道已落地：自带三科，不问年级 / 地区。
    fireEvent.click(screen.getByRole("button", { name: /考研/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByRole("heading", { name: "定下目标" })).toBeInTheDocument();
    expect(screen.getByLabelText("目标名称")).toHaveValue("考研");
    expect(screen.queryByRole("button", { name: "高二" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("地区")).not.toBeInTheDocument();
    // 高考的六科不带过来。
    expect(screen.queryByLabelText("语文")).not.toBeInTheDocument();
    expect(screen.getByLabelText("政治")).toHaveValue("70");
    expect(screen.getByLabelText("英语")).toHaveValue("70");
    expect(screen.getByLabelText("数学")).toHaveValue("100");
    // 满分上限来自模板本身。
    expect(screen.getByLabelText("总分目标")).toHaveAttribute("placeholder", "1–500");
  });

  it("onboarding_takes_the_date_rule_from_the_track_package", async () => {
    // 装了赛道包之后，目标日期按包里的规则算，不再是内置模板那份。
    plugins = [
      {
        id: "track-gaokao",
        name: "高考赛道",
        summary: "",
        author: "",
        version: "",
        icon: "",
        size_kb: 1,
        capabilities: [],
        options: [],
        kind: "track",
        provides: {
          track: { name: "高考" },
          goals: [
            {
              name: "高考",
              date_rule: {
                id: "gaokao-june-20",
                anchor: "06-20",
                grade_offsets: { 高一: 2, 高二: 1, 高三: 0 },
              },
            },
          ],
        },
        installed: true,
      },
    ];

    renderGate();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "你在为什么努力" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    // 包里的规则说了算：06-20 而不是内置模板那份 06-07。
    await waitFor(() => {
      expect(screen.getByLabelText("目标日期")).toHaveValue("2027-06-20");
    });
    expect(screen.getByText(/预计考试日 2027-06-20/)).toBeInTheDocument();
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
