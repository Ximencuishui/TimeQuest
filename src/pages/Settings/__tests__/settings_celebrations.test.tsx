import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function celebrationsBox(): HTMLInputElement {
  const box = screen.getByRole("checkbox", { name: "启用里程碑特效" });
  if (!(box instanceof HTMLInputElement)) {
    throw new Error("celebrations checkbox missing");
  }
  return box;
}

function setSettingCalls(): { key?: string; value?: string }[] {
  return mockedInvoke.mock.calls
    .filter((call) => call[0] === "set_setting")
    .map((call) => call[1] as { key?: string; value?: string });
}

describe("Settings celebrations", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().setExams([
      { id: "gaokao", name: "高考", date: "2027-06-07", isPrimary: true },
    ]);
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("settings_celebrations_toggle_writes_enable_celebrations", async () => {
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_setting") {
        const key = (args as { key?: string } | undefined)?.key;
        if (key === "enable_celebrations") return null;
        return null;
      }
      if (cmd === "list_user_achievements") return [];
      return null;
    });

    renderSettings();
    await waitFor(() => expect(celebrationsBox()).toBeEnabled());
    expect(celebrationsBox()).toBeChecked();

    fireEvent.click(celebrationsBox());
    await waitFor(() => {
      expect(setSettingCalls()).toContainEqual({
        key: "enable_celebrations",
        value: "0",
      });
    });
  });

  it("settings_celebrations_off_value_starts_unchecked_and_writes_one", async () => {
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_setting") {
        const key = (args as { key?: string } | undefined)?.key;
        if (key === "enable_celebrations") return "0";
        return null;
      }
      if (cmd === "list_user_achievements") return [];
      return null;
    });

    renderSettings();
    await waitFor(() => expect(celebrationsBox()).toBeEnabled());
    expect(celebrationsBox()).not.toBeChecked();

    fireEvent.click(celebrationsBox());
    await waitFor(() => {
      expect(setSettingCalls()).toContainEqual({
        key: "enable_celebrations",
        value: "1",
      });
    });
  });
});
