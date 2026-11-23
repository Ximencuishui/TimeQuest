import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeGoal, setGoalFixtures } from "../../../test/mockGoals";
import { Settings } from "../../Settings.tsx";

vi.mock("../../../hooks/useGoals", async () => await import("../../../test/mockGoals"));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setAlwaysOnTop: vi.fn() }),
}));

const mockedInvoke = vi.mocked(invoke);

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Settings />
    </QueryClientProvider>,
  );
}

describe("Settings achievements null response", () => {
  beforeEach(() => {
    localStorage.clear();
    setGoalFixtures([
      makeGoal({ id: 1, name: "高考", date: "2027-06-07", isPrimary: true }),
    ]);
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("settings_achievements_null_response_renders_empty_state_without_crash", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      // 后端异常返回 null：useAchievements 必须把它归一成空数组，
      // 否则 achievements.length 抛错，React 会卸载整棵树变成白屏。
      if (cmd === "list_user_achievements") return null;
      return null;
    });

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("尚未解锁成就")).toBeInTheDocument();
    });
    expect(mockedInvoke).toHaveBeenCalledWith("list_user_achievements");
  });
});
