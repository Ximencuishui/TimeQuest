import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CountdownPanel } from "../../../components/CountdownPanel";
import { Layout } from "../../../components/Layout";
import { DEFAULT_USER_PROFILE } from "../../../lib/profile";
import { useUiStore } from "../../../store/ui";
import type { UserProfile } from "../../../types";
import { Settings } from "../../Settings.tsx";

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
};

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
    useUiStore.getState().setExams([
      { id: "gaokao", name: "高考", date: "2027-06-07", isPrimary: true },
    ]);
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_user_profile") return LOADED;
      if (cmd === "update_user_profile") {
        return (args as { profile: UserProfile }).profile;
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
    const math = screen.getByLabelText("数学");
    expect(math).toHaveValue("130");
    expect(screen.getByText("各科合计 610，与总分目标一致")).toBeInTheDocument();

    fireEvent.change(math, { target: { value: "140" } });
    expect(screen.getByText("各科合计 620，比总分目标多 10 分")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("总分目标"), { target: { value: "620" } });
    expect(screen.getByText("各科合计 620，与总分目标一致")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "update_user_profile",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({
        profile: {
          avatar: LOADED.avatar,
          grade: "高三",
          region: "湖南",
          total_target: 620,
          subject_targets: {
            chinese: 120,
            math: 140,
            english: 120,
            physics: 80,
            chemistry: 80,
            biology: 80,
          },
        },
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

    expect(screen.getByRole("dialog", { name: "年级会改高考日期" })).toHaveTextContent(
      "2029-06-07",
    );
    expect(
      mockedInvoke.mock.calls.filter((call) => call[0] === "update_user_profile"),
    ).toHaveLength(0);
    expect(useUiStore.getState().exams.find((exam) => exam.isPrimary)?.date).toBe(
      "2027-06-07",
    );

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "年级会改高考日期" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("年级")).toHaveValue("高三");
    expect(
      mockedInvoke.mock.calls.filter((call) => call[0] === "update_user_profile"),
    ).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("年级"), { target: { value: "高一" } });
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));
    fireEvent.click(screen.getByRole("button", { name: "更新高考日期" }));

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
    expect(useUiStore.getState().exams.find((exam) => exam.isPrimary)?.date).toBe(
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
    expect(screen.getByRole("dialog", { name: "年级会改高考日期" })).toHaveTextContent(
      "2028-06-07",
    );

    fireEvent.click(screen.getByRole("button", { name: "更新高考日期" }));

    await waitFor(() => {
      expect(screen.getByText("目标日 2028-06-07")).toBeInTheDocument();
    });
    expect(useUiStore.getState().exams.find((exam) => exam.isPrimary)?.date).toBe(
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
