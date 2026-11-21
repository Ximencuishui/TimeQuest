import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeRangeField } from "../TimeRangeField";

const mockedInvoke = vi.mocked(invoke);

function renderField() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Harness() {
    const [start, setStart] = useState("09:00");
    const [end, setEnd] = useState("10:00");
    return (
      <TimeRangeField
        start={start}
        end={end}
        onChange={(nextStart, nextEnd) => {
          setStart(nextStart);
          setEnd(nextEnd);
        }}
      />
    );
  }
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

function callsOf(command: string): { key?: string; value?: string; input?: unknown }[] {
  return mockedInvoke.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => call[1] as { key?: string; value?: string; input?: unknown });
}

describe("常用时长编辑器", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_setting") return null;
      if (cmd === "apply_preset_duration_changes") {
        return { matched: 1, updated: 1, conflicts: 0 };
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("time_range_field_shows_duration_buttons_with_a_settings_icon", async () => {
    renderField();

    // 默认时长按番茄钟算法推荐。
    expect(await screen.findByRole("button", { name: "番茄 1 · 25 分钟" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑常用时长" })).toBeInTheDocument();
  });

  it("duration_gear_opens_the_editor", async () => {
    renderField();

    fireEvent.click(screen.getByRole("button", { name: "编辑常用时长" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("第 1 段名称")).toHaveValue("番茄 1");
    expect(screen.getByLabelText("第 1 段分钟")).toHaveValue(25);
  });

  it("duration_editor_saves_presets_and_syncs_future_sessions", async () => {
    renderField();

    fireEvent.click(screen.getByRole("button", { name: "编辑常用时长" }));
    fireEvent.change(screen.getByLabelText("第 1 段分钟"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    // 先批量改排期，再存设置：两边一起生效。
    await waitFor(() => {
      expect(callsOf("apply_preset_duration_changes")).toHaveLength(1);
    });
    expect(callsOf("apply_preset_duration_changes")[0].input).toMatchObject({
      changes: [{ fromMinutes: 25, toMinutes: 30 }],
    });

    await waitFor(() => {
      expect(
        callsOf("set_setting").filter((call) => call.key === "duration_presets"),
      ).toHaveLength(1);
    });
    const saved = callsOf("set_setting").find((call) => call.key === "duration_presets");
    const parsed = JSON.parse(String(saved?.value)) as {
      id: string;
      label: string;
      minutes: number;
    }[];
    expect(parsed.find((item) => item.id === "dp-pomo-1")).toMatchObject({ minutes: 30 });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/1 场排期已改成新的常用时长/)).toBeInTheDocument();
  });

  it("duration_editor_label_only_edit_does_not_touch_the_plan", async () => {
    renderField();

    fireEvent.click(screen.getByRole("button", { name: "编辑常用时长" }));
    fireEvent.change(screen.getByLabelText("第 1 段名称"), {
      target: { value: "晨读番茄" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(callsOf("set_setting")).not.toHaveLength(0);
    });
    expect(callsOf("apply_preset_duration_changes")).toHaveLength(0);
  });

  it("duration_editor_rejects_invalid_minutes", async () => {
    renderField();

    fireEvent.click(screen.getByRole("button", { name: "编辑常用时长" }));
    fireEvent.change(screen.getByLabelText("第 1 段分钟"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("分钟数要在 1 到 1440 之间");
    expect(callsOf("set_setting")).toHaveLength(0);
    expect(callsOf("apply_preset_duration_changes")).toHaveLength(0);
  });

  it("duration_editor_can_generate_from_the_pomodoro_algorithm", async () => {
    renderField();

    fireEvent.click(screen.getByRole("button", { name: "编辑常用时长" }));
    fireEvent.change(screen.getByLabelText("番茄钟专注分钟"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "按番茄钟生成" }));

    // 30 专注 + 5 短休息 → 30 / 65 / 100 / 135 / 150
    expect(screen.getByLabelText("第 1 段分钟")).toHaveValue(30);
    expect(screen.getByLabelText("第 2 段分钟")).toHaveValue(65);
    expect(screen.getByLabelText("第 5 段分钟")).toHaveValue(150);
  });

  it("duration_editor_can_add_and_delete_presets", async () => {
    renderField();

    fireEvent.click(screen.getByRole("button", { name: "编辑常用时长" }));
    fireEvent.click(screen.getByRole("button", { name: "添加时长" }));
    expect(screen.getByLabelText("第 6 段名称")).toHaveValue("自定义");

    fireEvent.click(screen.getByRole("button", { name: "删除第 6 段" }));
    expect(screen.queryByLabelText("第 6 段名称")).not.toBeInTheDocument();
  });

  it("duration_editor_applies_the_shift_before_saving_settings", async () => {
    renderField();

    fireEvent.click(screen.getByRole("button", { name: "编辑常用时长" }));
    fireEvent.change(screen.getByLabelText("第 1 段分钟"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(callsOf("set_setting")).not.toHaveLength(0);
    });

    // 顺序不能反：先把排期改了，再把设置存上。
    const commands = mockedInvoke.mock.calls.map((call) => call[0]);
    const shiftIndex = commands.indexOf("apply_preset_duration_changes");
    const settingIndex = commands.indexOf("set_setting");
    expect(shiftIndex).toBeGreaterThanOrEqual(0);
    expect(settingIndex).toBeGreaterThan(shiftIndex);
  });

  it("duration_editor_keeps_open_when_saving_settings_fails", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_setting") return null;
      if (cmd === "apply_preset_duration_changes") {
        return { matched: 1, updated: 1, conflicts: 0 };
      }
      if (cmd === "set_setting") throw new Error("写不进库");
      return null;
    });
    renderField();

    fireEvent.click(screen.getByRole("button", { name: "编辑常用时长" }));
    fireEvent.change(screen.getByLabelText("第 1 段分钟"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    // 排期已经改了、设置没存上：得说清楚，不能悄悄关窗装作保存成功。
    expect(await screen.findByRole("alert")).toHaveTextContent("排期已改成功");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("duration_editor_warns_when_the_pomodoro_plan_is_too_long_for_one_day", async () => {
    renderField();

    fireEvent.click(screen.getByRole("button", { name: "编辑常用时长" }));
    fireEvent.change(screen.getByLabelText("番茄钟专注分钟"), {
      target: { value: "180" },
    });
    fireEvent.change(screen.getByLabelText("番茄钟一轮番茄数"), {
      target: { value: "12" },
    });

    // 180 专注 + 60 短休息，12 个番茄排不下一天：只生成能排下的那几段。
    expect(screen.getByText(/超过一天 1440 分钟/)).toBeInTheDocument();
  });
});