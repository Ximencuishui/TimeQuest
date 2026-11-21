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

function autoScheduleBox(): HTMLInputElement {
  const box = screen.getByRole("checkbox", { name: "启动时自动排今天的计划" });
  if (!(box instanceof HTMLInputElement)) {
    throw new Error("auto schedule checkbox missing");
  }
  return box;
}

function setSettingCalls(): { key?: string; value?: string }[] {
  return mockedInvoke.mock.calls
    .filter((call) => call[0] === "set_setting")
    .map((call) => call[1] as { key?: string; value?: string });
}

describe("Settings 自动排期", () => {
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

  it("settings_auto_schedule_defaults_on_and_writes_zero_when_turned_off", async () => {
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_setting") {
        const key = (args as { key?: string } | undefined)?.key;
        if (key === "auto_schedule_today") return null;
        return null;
      }
      if (cmd === "list_user_achievements") return [];
      return null;
    });

    renderSettings();
    await waitFor(() => expect(autoScheduleBox()).toBeEnabled());
    expect(autoScheduleBox()).toBeChecked();

    fireEvent.click(autoScheduleBox());
    await waitFor(() => {
      expect(setSettingCalls()).toContainEqual({
        key: "auto_schedule_today",
        value: "0",
      });
    });
  });

  it("settings_auto_schedule_off_value_starts_unchecked_and_writes_one", async () => {
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_setting") {
        const key = (args as { key?: string } | undefined)?.key;
        if (key === "auto_schedule_today") return "0";
        return null;
      }
      if (cmd === "list_user_achievements") return [];
      return null;
    });

    renderSettings();
    await waitFor(() => expect(autoScheduleBox()).toBeEnabled());
    expect(autoScheduleBox()).not.toBeChecked();

    fireEvent.click(autoScheduleBox());
    await waitFor(() => {
      expect(setSettingCalls()).toContainEqual({
        key: "auto_schedule_today",
        value: "1",
      });
    });
  });
});
