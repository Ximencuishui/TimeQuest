import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dailyMotivation } from "../../../lib/motivation";
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
const SAVED = "已保存的一句";
const NEXT = "我要上清华";

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

function motivationInput(): HTMLInputElement {
  const input = screen.getByLabelText("自定义激励语");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("motivation input missing");
  }
  return input;
}

function setSettingCalls(): { key?: string; value?: string }[] {
  return mockedInvoke.mock.calls
    .filter((call) => call[0] === "set_setting")
    .map((call) => call[1] as { key?: string; value?: string });
}

describe("Settings motivation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    localStorage.clear();
    useUiStore.getState().setExams([
      { id: "gaokao", name: "高考", date: "2027-06-07", isPrimary: true },
    ]);
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_setting") return SAVED;
      if (cmd === "list_user_achievements") return [];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("settings_motivation_save_invokes_set_setting", async () => {
    renderSettings();
    const input = motivationInput();
    await waitFor(() => expect(input).toHaveValue(SAVED));
    expect(screen.queryByText(dailyMotivation("2026-01-01"))).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: NEXT } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(setSettingCalls()).toEqual([
        { key: "motivation_text", value: NEXT },
      ]);
    });
    expect(input).toHaveValue(NEXT);
  });

  it("settings_motivation_clear_writes_empty_and_shows_default", async () => {
    renderSettings();
    const input = motivationInput();
    await waitFor(() => expect(input).toHaveValue(SAVED));
    const fallback = dailyMotivation("2026-01-01");
    expect(screen.queryByText(fallback)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清空" }));

    expect(input).toHaveValue("");
    expect(screen.getByText(fallback)).toBeInTheDocument();
    await waitFor(() => {
      expect(setSettingCalls()).toEqual([
        { key: "motivation_text", value: "" },
      ]);
    });
  });
});