import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

async function openEditor() {
  fireEvent.click(screen.getByRole("button", { name: "编辑常用时段" }));
  await screen.findByLabelText("第 1 段名称");
}

function callsOf(command: string): { key?: string; value?: string; input?: unknown }[] {
  return mockedInvoke.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => call[1] as { key?: string; value?: string; input?: unknown });
}

describe("常用时段编辑器", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_setting") return null;
      if (cmd === "apply_preset_time_changes") {
        return { matched: 1, updated: 1, conflicts: 0 };
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("time_range_field_shows_preset_buttons_with_a_settings_icon", async () => {
    renderField();

    expect(
      await screen.findByRole("button", { name: "晚上 19:00–20:00" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑常用时段" })).toBeInTheDocument();
  });

  it("time_range_field_gear_opens_the_editor", async () => {
    renderField();

    await openEditor();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("第 1 段名称")).toHaveValue("早读");
    expect(screen.getByLabelText("第 5 段开始时间")).toHaveValue("14:00");
  });

  it("preset_editor_saves_presets_and_syncs_future_sessions", async () => {
    renderField();

    await openEditor();
    fireEvent.change(screen.getByLabelText("第 5 段开始时间"), {
      target: { value: "15:00" },
    });
    fireEvent.change(screen.getByLabelText("第 5 段结束时间"), {
      target: { value: "16:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    // 先批量挪排期，再存设置：两边一起生效。
    await waitFor(() => {
      expect(callsOf("apply_preset_time_changes")).toHaveLength(1);
    });
    expect(callsOf("apply_preset_time_changes")[0].input).toMatchObject({
      changes: [
        { fromStart: "14:00", fromEnd: "15:00", toStart: "15:00", toEnd: "16:00" },
      ],
    });

    await waitFor(() => {
      expect(callsOf("set_setting")).toHaveLength(1);
    });
    const saved = callsOf("set_setting")[0];
    expect(saved.key).toBe("time_presets");
    const parsed = JSON.parse(String(saved.value)) as {
      id: string;
      label: string;
      start: string;
      end: string;
    }[];
    const changed = parsed.find((item) => item.id === "tp-pm-1");
    expect(changed).toMatchObject({ start: "15:00", end: "16:00" });

    // 保存后弹窗关闭，并告诉用户计划被同步了多少场。
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/1 场排期已挪到新的常用时段/)).toBeInTheDocument();
  });

  it("preset_editor_label_only_edit_does_not_touch_the_plan", async () => {
    renderField();

    await openEditor();
    fireEvent.change(screen.getByLabelText("第 1 段名称"), {
      target: { value: "晨读" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(callsOf("set_setting")).toHaveLength(1);
    });
    expect(callsOf("apply_preset_time_changes")).toHaveLength(0);
  });

  it("preset_editor_rejects_end_before_start", async () => {
    renderField();

    await openEditor();
    fireEvent.change(screen.getByLabelText("第 1 段结束时间"), {
      target: { value: "06:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("结束时间要晚于开始时间");
    expect(callsOf("set_setting")).toHaveLength(0);
    expect(callsOf("apply_preset_time_changes")).toHaveLength(0);
  });

  it("preset_editor_can_add_and_delete_presets", async () => {
    renderField();

    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "添加时段" }));
    expect(screen.getByLabelText("第 11 段名称")).toHaveValue("自定义");

    fireEvent.click(screen.getByRole("button", { name: "删除第 11 段" }));
    expect(screen.queryByLabelText("第 11 段名称")).not.toBeInTheDocument();
  });

  it("preset_editor_applies_the_shift_before_saving_settings", async () => {
    renderField();

    await openEditor();
    fireEvent.change(screen.getByLabelText("第 5 段开始时间"), {
      target: { value: "15:00" },
    });
    fireEvent.change(screen.getByLabelText("第 5 段结束时间"), {
      target: { value: "16:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(callsOf("set_setting")).toHaveLength(1);
    });

    // 顺序不能反：先把排期挪了，再把设置存上。
    const commands = mockedInvoke.mock.calls.map((call) => call[0]);
    const shiftIndex = commands.indexOf("apply_preset_time_changes");
    const settingIndex = commands.indexOf("set_setting");
    expect(shiftIndex).toBeGreaterThanOrEqual(0);
    expect(settingIndex).toBeGreaterThan(shiftIndex);
  });

  it("preset_editor_keeps_open_when_the_shift_fails", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_setting") return null;
      if (cmd === "apply_preset_time_changes") throw new Error("后端炸了");
      return null;
    });
    renderField();

    await openEditor();
    fireEvent.change(screen.getByLabelText("第 5 段开始时间"), {
      target: { value: "15:00" },
    });
    fireEvent.change(screen.getByLabelText("第 5 段结束时间"), {
      target: { value: "16:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
    // 排期没挪成，设置也就不存：两边不能对不上。
    expect(callsOf("set_setting")).toHaveLength(0);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("preset_editor_disables_save_until_settings_are_fetched", async () => {
    let release = false;
    const pending: Array<() => void> = [];
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_setting" && !release) {
        await new Promise<void>((resolve) => {
          pending.push(resolve);
        });
      }
      return null;
    });
    renderField();

    fireEvent.click(screen.getByRole("button", { name: "编辑常用时段" }));
    expect(screen.getByText("正在读取已保存的时段…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    await act(async () => {
      release = true;
      pending.splice(0).forEach((resolve) => resolve());
    });
    expect(await screen.findByLabelText("第 1 段名称")).toHaveValue("早读");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });
});