import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CountdownPanel } from "../../../components/CountdownPanel";
import { Layout } from "../../../components/Layout";
import { DEFAULT_USER_PROFILE } from "../../../lib/profile";
import {
  getGoalFixtures,
  makeGoal,
  resetGoalMocks,
  setGoalFixtures,
} from "../../../test/mockGoals";
import { SUBJECT_FIXTURES } from "../../../test/subjectFixtures";
import type { Track, UpsertSubjectPayload, UserProfile } from "../../../types";
import { Settings } from "../../Settings.tsx";

vi.mock("../../../hooks/useGoals", async () => await import("../../../test/mockGoals"));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setAlwaysOnTop: vi.fn() }),
}));

const mockedInvoke = vi.mocked(invoke);

const LOADED: UserProfile = {
  ...DEFAULT_USER_PROFILE,
  region: "湖南省",
  avatar: "data:image/png;base64,qq",
  // 总分目标属于赛道：档案里没设就是 null（4.0 起默认不预填）。
  // 这份夹具显式带上，才能测「各科合计 vs 总分目标」的对照。
  total_target: 610,
};

/** 当前主赛道。目标日期按这条赛道的规则算，没有赛道就按不处理。 */
const TRACK_FIXTURES: Track[] = [
  {
    id: 1,
    name: "高考",
    kind: "exam",
    scoreMode: "total",
    isPrimary: true,
    color: null,
    createdAt: "2026-11-06 12:00:00",
  },
];

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CountdownPanel />
      <Settings />
    </QueryClientProvider>,
  );
}

describe("Settings profile", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0));
    localStorage.clear();
    resetGoalMocks();
    setGoalFixtures([
      makeGoal({ id: 1, name: "高考", date: "2027-06-07", isPrimary: true }),
    ]);
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_user_profile") return LOADED;
      if (cmd === "update_user_profile") {
        return (args as { profile: UserProfile }).profile;
      }
      if (cmd === "list_subjects") return SUBJECT_FIXTURES;
      if (cmd === "list_tracks") return TRACK_FIXTURES;
      if (cmd === "upsert_subject") {
        return (args as { payload: UpsertSubjectPayload }).payload;
      }
      if (cmd === "list_user_achievements") return [];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("settings_profile_save_invokes_update_user_profile", async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByLabelText("地区")).toHaveValue("湖南");
    });
    const mathGoal = screen.getByLabelText("数学 目标");
    expect(mathGoal).toHaveValue("130");
    expect(screen.getByText("各科合计 610，与总分目标一致")).toBeInTheDocument();

    fireEvent.change(mathGoal, { target: { value: "140" } });
    // React 的 onBlur 跟的是 focusout，所以要 fireEvent.focusOut。
    fireEvent.focusOut(mathGoal);
    expect(screen.getByText("各科合计 620，比总分目标多 10 分")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("总分目标"), { target: { value: "620" } });
    expect(screen.getByText("各科合计 620，与总分目标一致")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "update_user_profile",
      );
      expect(calls).toHaveLength(1);
      // 4.0 起科目不再跟档案一起存，档案只留头像/年级/地区/总分目标。
      expect(calls[0]?.[1]).toEqual({
        profile: {
          avatar: LOADED.avatar,
          grade: "高三",
          region: "湖南",
          total_target: 620,
        },
      });
    });

    // 改科目目标走 `subjects` 表，不进档案。
    await waitFor(() => {
      const subjectCalls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "upsert_subject",
      );
      expect(subjectCalls).toHaveLength(1);
      expect(
        (subjectCalls[0]?.[1] as { payload: UpsertSubjectPayload }).payload,
      ).toMatchObject({
        id: 2,
        key: "math",
        label: "数学",
        goal: 140,
      });
    });
  });

  it("settings_profile_grade_and_region_use_choices", async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByLabelText("年级")).toHaveValue("高三");
    });
    expect(screen.getByRole("option", { name: "高一" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "高二" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "高三" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("年级"), { target: { value: "高一" } });
    fireEvent.change(screen.getByLabelText("地区"), { target: { value: "广东" } });
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));

    // 年级会改目标日期：规则来自当前赛道（这里是「高考」）。
    expect(screen.getByRole("dialog", { name: "年级会改目标日期" })).toHaveTextContent(
      "2029-06-07",
    );
    expect(
      mockedInvoke.mock.calls.filter((call) => call[0] === "update_user_profile"),
    ).toHaveLength(0);
    expect(getGoalFixtures().find((exam) => exam.isPrimary)?.date).toBe(
      "2027-06-07",
    );

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "年级会改目标日期" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("年级")).toHaveValue("高三");
    expect(
      mockedInvoke.mock.calls.filter((call) => call[0] === "update_user_profile"),
    ).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("年级"), { target: { value: "高一" } });
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));
    fireEvent.click(screen.getByRole("button", { name: "更新目标日期" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "update_user_profile",
      );
      expect(calls).toHaveLength(1);
      expect((calls[0]?.[1] as { profile: UserProfile }).profile).toMatchObject({
        grade: "高一",
        region: "广东",
      });
    });
    expect(getGoalFixtures().find((exam) => exam.isPrimary)?.date).toBe(
      "2029-06-07",
    );
    expect(screen.getByText("目标日 2029-06-07")).toBeInTheDocument();
  });

  it("settings_grade_change_confirms_then_refreshes_countdown", async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("目标日 2027-06-07")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("年级"), { target: { value: "高二" } });
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));
    expect(screen.getByRole("dialog", { name: "年级会改目标日期" })).toHaveTextContent(
      "2028-06-07",
    );

    fireEvent.click(screen.getByRole("button", { name: "更新目标日期" }));

    await waitFor(() => {
      expect(screen.getByText("目标日 2028-06-07")).toBeInTheDocument();
    });
    expect(getGoalFixtures().find((exam) => exam.isPrimary)?.date).toBe(
      "2028-06-07",
    );
    const calls = mockedInvoke.mock.calls.filter(
      (call) => call[0] === "update_user_profile",
    );
    expect(calls).toHaveLength(1);
    expect((calls[0]?.[1] as { profile: UserProfile }).profile.grade).toBe("高二");
  });
});

describe("sidebar profile chip", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_user_profile") return LOADED;
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the avatar and shortened grade region line", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const lines = await screen.findAllByText("高三 · 湖南");
    expect(lines.length).toBeGreaterThan(0);
    const images = screen.getAllByRole("img", { name: "头像" });
    expect(images.some((img) => img.getAttribute("src") === LOADED.avatar)).toBe(true);
  });
});

