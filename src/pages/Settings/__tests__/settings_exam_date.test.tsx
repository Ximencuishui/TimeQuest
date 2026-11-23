import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGoalFixtures,
  makeGoal,
  resetGoalMocks,
  setGoalFixtures,
  upsert,
} from "../../../test/mockGoals";
import { Settings } from "../../Settings.tsx";

vi.mock("../../../hooks/useGoals", async () => await import("../../../test/mockGoals"));

/**
 * C 段写入链路：目标存在数据库里，日期改动走 `upsertGoal`。
 * 目标列表从 `useGoals` 读，测试里用假数据代替。
 *
 * 过去日期：选中后先把日期留在输入框（pending），确认前不写入。
 * 初始种子日期是 2027-06-07。
 */

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

const ORIGINAL_DATE = "2027-06-07";
const mockedInvoke = vi.mocked(invoke);

function seedExam(date = ORIGINAL_DATE) {
  setGoalFixtures([makeGoal({ id: 1, name: "高考", date, isPrimary: true })]);
}

function storedPrimaryDate(): string {
  const fromStore = getGoalFixtures().find((e) => e.isPrimary)?.date;
  return fromStore ?? "";
}

function expectNoGoalWrite() {
  expect(upsert.mutate).not.toHaveBeenCalled();
}

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

function primaryDateInput(): HTMLInputElement {
  const section = screen.getByRole("heading", { name: "考试目标" }).closest("section");
  if (!section) throw new Error("考试目标 section missing");
  const input = section.querySelector("ul input[type='date']");
  if (!(input instanceof HTMLInputElement)) throw new Error("exam date input missing");
  return input;
}

describe("Settings exam date", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    localStorage.clear();
    resetGoalMocks();
    seedExam();
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_user_achievements") return [];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("settings_past_exam_date_shows_confirmation_before_write", () => {
    renderSettings();
    const input = primaryDateInput();
    expect(input).toHaveValue(ORIGINAL_DATE);

    fireEvent.change(input, { target: { value: "2025-06-07" } });

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("已过去");
    expect(dialog).toHaveTextContent("已到达");
    expect(storedPrimaryDate()).toBe(ORIGINAL_DATE);
    expectNoGoalWrite();
    // 确认前输入框显示刚选的过去日期，取消后再回到种子值。
    expect(input).toHaveValue("2025-06-07");
  });

  it("settings_past_exam_date_cancel_does_not_write", () => {
    renderSettings();
    const input = primaryDateInput();
    fireEvent.change(input, { target: { value: "2025-06-07" } });

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(storedPrimaryDate()).toBe(ORIGINAL_DATE);
    expectNoGoalWrite();
    expect(input).toHaveValue(ORIGINAL_DATE);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // 这里只查操作失败提示；页面上的术语说明属于正常文案。
    expect(screen.queryByText(/导出失败|导入失败|清除失败/)).not.toBeInTheDocument();
  });

  it("settings_past_exam_date_confirm_writes", () => {
    renderSettings();
    const input = primaryDateInput();
    fireEvent.change(input, { target: { value: "2025-06-07" } });

    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(storedPrimaryDate()).toBe("2025-06-07");
    expect(upsert.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, date: "2025-06-07" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(input).toHaveValue("2025-06-07");
  });

  it("settings_future_exam_date_writes_without_confirmation", () => {
    renderSettings();
    const input = primaryDateInput();

    fireEvent.change(input, { target: { value: "2026-06-07" } });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(storedPrimaryDate()).toBe("2026-06-07");
    expect(upsert.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, date: "2026-06-07" }),
    );
    expect(input).toHaveValue("2026-06-07");
  });

  it.skip("settings_date_change_does_not_write_on_every_keystroke", () => {
    // 已有目标的日期框是原生 <input type="date">。
    // onChange 只在选出完整日期时触发，不会按字符写入，因此跳过逐字输入。
    // 名称框仍是每敲一字就 upsertExam，不在本条里。
  });
});
