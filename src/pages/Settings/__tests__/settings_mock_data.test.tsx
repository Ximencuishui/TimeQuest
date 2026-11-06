import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_PROFILE } from "../../../lib/profile";
import { useUiStore } from "../../../store/ui";
import { Settings } from "../../Settings.tsx";

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

describe("Settings mock data", () => {
  let hasMock = false;

  beforeEach(() => {
    hasMock = false;
    localStorage.clear();
    useUiStore.getState().setExams([
      { id: "gaokao", name: "高考", date: "2027-06-07", isPrimary: true },
    ]);
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_user_profile") return DEFAULT_USER_PROFILE;
      if (cmd === "list_user_achievements") return [];
      if (cmd === "has_mock_data") return hasMock;
      if (cmd === "clear_mock_data") {
        hasMock = false;
        return null;
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("settings_clear_mock_highlights_and_confirms_before_delete", async () => {
    hasMock = true;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSettings();

    const button = await screen.findByRole("button", { name: "清除所有演示数据" });
    await waitFor(() => {
      expect(button).toHaveAttribute("data-highlighted", "true");
    });
    expect(button.className).toContain("bg-accent");
    expect(screen.getByText("当前有演示数据。清除只会去掉这些演示记录。")).toBeInTheDocument();

    fireEvent.click(button);
    expect(confirm).toHaveBeenCalled();
    expect(mockedInvoke).not.toHaveBeenCalledWith("clear_mock_data");
    expect(button).toHaveAttribute("data-highlighted", "true");

    confirm.mockReturnValue(true);
    fireEvent.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute("data-highlighted", "false");
    });
    expect(screen.getByText("演示数据已清除。")).toBeInTheDocument();
    expect(mockedInvoke).toHaveBeenCalledWith("clear_mock_data");
  });
});
