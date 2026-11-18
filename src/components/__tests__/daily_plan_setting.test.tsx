import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyPlanSetting } from "../DailyPlanSetting";

const mockedInvoke = vi.mocked(invoke);

/** 存盘时段故意和默认三段不一样，方便确认真的读到了设置。 */
const SAVED_SLOTS = [["07:00", "07:45"]];

function setSettingCalls(key: string): unknown[][] {
  return mockedInvoke.mock.calls.filter(
    (call) => call[0] === "set_setting" && (call[1] as { key?: string })?.key === key,
  );
}

function renderSetting() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DailyPlanSetting />
    </QueryClientProvider>,
  );
}

async function waitForLoadedSlots() {
  await waitFor(() => {
    expect(screen.getByLabelText("第 1 段开始时间")).toHaveValue("07:00");
  });
}

describe("DailyPlanSetting", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_setting") {
        const key = (args as { key?: string })?.key;
        if (key === "daily_slots") return JSON.stringify(SAVED_SLOTS);
        if (key === "daily_limit_minutes") return "360";
        return null;
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("daily_plan_setting_loads_saved_slots_and_limit", async () => {
    renderSetting();
    await waitForLoadedSlots();

    expect(screen.getByLabelText("第 1 段结束时间")).toHaveValue("07:45");
    expect(screen.getAllByLabelText(/第 \d 段开始时间/)).toHaveLength(1);
    expect(screen.getByLabelText("每日学习上限（小时）")).toHaveValue(6);
    expect(screen.getByText("一天共 45 分钟可用。")).toBeInTheDocument();
  });

  it("daily_plan_setting_saves_preset_slots_and_limit", async () => {
    const user = userEvent.setup();
    renderSetting();
    await waitForLoadedSlots();

    await user.click(screen.getByRole("button", { name: "上午" }));
    expect(screen.getByLabelText("第 1 段开始时间")).toHaveValue("08:00");
    expect(screen.getByLabelText("第 1 段结束时间")).toHaveValue("11:30");

    await user.click(screen.getByRole("button", { name: "保存时段" }));

    await waitFor(() => {
      expect(setSettingCalls("daily_slots").length).toBe(1);
    });
    expect((setSettingCalls("daily_slots")[0]?.[1] as { value: string }).value).toBe(
      JSON.stringify([["08:00", "11:30"]]),
    );
    expect((setSettingCalls("daily_limit_minutes")[0]?.[1] as { value: string }).value).toBe("360");
    expect(screen.getByText("已保存。")).toBeInTheDocument();
  });

  it("daily_plan_setting_drops_invalid_slot_on_save", async () => {
    const user = userEvent.setup();
    renderSetting();
    await waitForLoadedSlots();

    // 结束时间早于开始时间：保存时应该被忽略并提示。
    fireEvent.change(screen.getByLabelText("第 1 段结束时间"), { target: { value: "06:00" } });
    await user.click(screen.getByRole("button", { name: "保存时段" }));

    await waitFor(() => {
      expect(setSettingCalls("daily_slots").length).toBe(1);
    });
    expect((setSettingCalls("daily_slots")[0]?.[1] as { value: string }).value).toBe("[]");
    expect(screen.getByText("已保存；有 1 段时间不合法，已忽略。")).toBeInTheDocument();
  });

  it("daily_plan_setting_adds_and_removes_slots", async () => {
    const user = userEvent.setup();
    renderSetting();
    await waitForLoadedSlots();

    await user.click(screen.getByRole("button", { name: "添加时段" }));
    expect(screen.getByLabelText("第 2 段开始时间")).toHaveValue("09:00");

    await user.click(screen.getByRole("button", { name: "删除第 1 段" }));
    expect(screen.getAllByLabelText(/第 \d 段开始时间/)).toHaveLength(1);
    expect(screen.getByLabelText("第 1 段开始时间")).toHaveValue("09:00");
  });
});