import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppSetting } from "../../../hooks/useAppSetting";
import { DEFAULT_MOTIVATIONS } from "../../../lib/constants";
import { useUiStore } from "../../../store/ui";
import { Dashboard } from "../../Dashboard.tsx";

vi.mock("../../../hooks/useAppSetting", () => ({
  useAppSetting: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedUseAppSetting = vi.mocked(useAppSetting);

function mockSetting(data: string | null) {
  mockedUseAppSetting.mockReturnValue({
    data,
    setSetting: { mutate: vi.fn(), mutateAsync: vi.fn() },
  } as unknown as ReturnType<typeof useAppSetting>);
}

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function visibleDefault(): string {
  const found = DEFAULT_MOTIVATIONS.filter((line) => screen.queryByText(line));
  expect(found).toHaveLength(1);
  return found[0];
}

describe("Dashboard daily motivation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    localStorage.clear();
    useUiStore.getState().setExams([
      { id: "gaokao", name: "高考", date: "2026-06-07", isPrimary: true },
    ]);
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_sessions_by_date") return [];
      if (cmd === "list_tasks") return [];
      return null;
    });
    mockedUseAppSetting.mockReset();
    let seq = 0;
    vi.spyOn(window, "setInterval").mockImplementation(() => {
      seq += 1;
      return seq as unknown as ReturnType<typeof setInterval>;
    });
    vi.spyOn(window, "clearInterval").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("dashboard_motivation_uses_default_when_setting_empty", () => {
    mockSetting(null);
    renderDashboard();

    expect(mockedUseAppSetting).toHaveBeenCalledWith("motivation_text");
    const first = visibleDefault();
    const quote = screen.getByText(first).closest("blockquote");
    expect(quote).toHaveClass("italic", "text-zinc-400");
    expect(screen.getByRole("heading", { name: "TimeQuest" }).closest("header")).toContainElement(
      screen.getByText(first),
    );

    cleanup();
    renderDashboard();
    expect(visibleDefault()).toBe(first);

    vi.setSystemTime(new Date(2026, 0, 2, 12, 0, 0));
    cleanup();
    renderDashboard();
    expect(visibleDefault()).not.toBe(first);
  });

  it("dashboard_motivation_renders_custom_text", () => {
    mockSetting("我要上清华");
    renderDashboard();

    expect(mockedUseAppSetting).toHaveBeenCalledWith("motivation_text");
    const node = screen.getByText("我要上清华");
    expect(node.closest("blockquote")).toHaveClass("italic", "text-zinc-400");
    expect(screen.getByRole("heading", { name: "TimeQuest" }).closest("header")).toContainElement(
      node,
    );
    for (const line of DEFAULT_MOTIVATIONS) {
      expect(screen.queryByText(line)).not.toBeInTheDocument();
    }
  });
});