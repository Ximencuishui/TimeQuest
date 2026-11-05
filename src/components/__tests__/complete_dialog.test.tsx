import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/tauri";
import type { TaskSession } from "../../types";
import { CompleteDialog } from "../CompleteDialog";

const mockedInvoke = vi.mocked(invoke);

const session: TaskSession = {
  id: 42,
  task_id: 1,
  date: "2026-05-01",
  start_time: "09:00",
  end_time: "10:00",
  round: 1,
  status: "planned",
  planned_units: 5,
  actual_units: 0,
  self_rating: null,
  self_note: null,
  rescheduled_to: null,
  xp_awarded: 0,
  created_at: "2026-05-01 08:00:00",
  task_title: "主线数学",
  task_type: "main",
};

/** Mirror Today.tsx: dialog onSubmit → api.completeSession → invoke("complete_session", { input }). */
function renderDialog(target: TaskSession = session) {
  return render(
    <CompleteDialog
      session={target}
      onClose={() => undefined}
      onSubmit={async (data) => {
        await api.completeSession({
          sessionId: target.id,
          actualUnits: data.actualUnits,
          selfRating: data.selfRating,
          selfNote: data.selfNote || null,
          method: data.method,
          deferRemaining: data.deferRemaining,
          deferDate: data.deferDate,
          deferStart: data.deferStart,
          deferEnd: data.deferEnd,
        });
      }}
    />,
  );
}

const zeroPlannedSession: TaskSession = {
  ...session,
  id: 99,
  start_time: "09:00",
  end_time: "09:30",
  planned_units: 0,
};

function completeInvokeArgs() {
  expect(mockedInvoke).toHaveBeenCalledTimes(1);
  const [cmd, arg] = mockedInvoke.mock.calls[0]!;
  expect(cmd).toBe("complete_session");
  expect(arg).toEqual(expect.objectContaining({ input: expect.any(Object) }));
  return (arg as { input: Record<string, unknown> }).input;
}

describe("CompleteDialog deferRemaining", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue({
      session,
      xpAwarded: 0,
      newAchievements: [],
      createdSessionId: null,
      remainderSessionId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("complete_dialog_defer_remaining_passes_flag_and_spawns_session", async () => {
    const user = userEvent.setup();
    renderDialog();

    const units = screen.getByLabelText(/实际课数/);
    await user.clear(units);
    await user.type(units, "3");

    await user.click(screen.getByRole("checkbox", { name: /剩余.*改到下次/ }));

    const dateInput = screen.getByDisplayValue(/\d{4}-\d{2}-\d{2}/);
    const timeInputs = document.querySelectorAll('input[type="time"]');
    expect(timeInputs.length).toBe(2);

    await user.clear(dateInput);
    await user.type(dateInput, "2026-06-01");
    await user.clear(timeInputs[0]!);
    await user.type(timeInputs[0]!, "19:00");
    await user.clear(timeInputs[1]!);
    await user.type(timeInputs[1]!, "20:00");

    await user.click(screen.getByRole("button", { name: "确认完成" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalled();
    });

    // B 段确认：wire 为 camelCase（serde rename_all），嵌在 { input } 里。
    const input = completeInvokeArgs();
    expect(input.actualUnits).toBe(3);
    expect(input.deferRemaining).toBe(true);
    expect(input.deferDate).toBe("2026-06-01");
    expect(input.deferStart).toBe("19:00");
    expect(input.deferEnd).toBe("20:00");
  });

  it("complete_dialog_without_defer_does_not_send_defer_fields", async () => {
    const user = userEvent.setup();
    renderDialog();

    const units = screen.getByLabelText(/实际课数/);
    await user.clear(units);
    await user.type(units, "3");

    // 不勾选「剩余改到下次」
    expect(screen.getByRole("checkbox", { name: /剩余.*改到下次/ })).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "确认完成" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalled();
    });

    const input = completeInvokeArgs();
    expect(input.actualUnits).toBe(3);
    // B 段：未勾选时前端传 false（非省略）。
    expect(input.deferRemaining).toBe(false);
    // 未勾选不得带默认时段，避免后端误生成 remainder（缺省或 null）。
    expect(input.deferDate == null).toBe(true);
    expect(input.deferStart == null).toBe(true);
    expect(input.deferEnd == null).toBe(true);
  });

  it("complete_dialog_full_completion_hides_defer_option", async () => {
    const user = userEvent.setup();
    renderDialog();

    const units = screen.getByLabelText(/实际课数/);
    await user.clear(units);
    await user.type(units, "5");

    expect(
      screen.queryByRole("checkbox", { name: /剩余.*改到下次/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/改到下次/)).not.toBeInTheDocument();
  });

  it("complete_dialog_zero_planned_units_submits_zero_and_hides_defer", async () => {
    const user = userEvent.setup();
    renderDialog(zeroPlannedSession);

    const units = screen.getByLabelText(/实际课数/) as HTMLInputElement;
    // A 段：默认值来自 session.planned_units（此处为 0），非固定 1。
    expect(units.value).toBe("0");

    // planned_units <= actual_units → partial=false，与满额完成同一条判断，不显示 defer。
    expect(
      screen.queryByRole("checkbox", { name: /剩余.*改到下次/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/改到下次/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认完成" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalled();
    });

    const input = completeInvokeArgs();
    expect(input.actualUnits).toBe(0);
    expect(input.deferRemaining).not.toBe(true);
    expect(input.deferRemaining).toBe(false);
    expect(input.deferDate == null).toBe(true);
    expect(input.deferStart == null).toBe(true);
    expect(input.deferEnd == null).toBe(true);
  });

  it("complete_dialog_zero_planned_units_allows_manual_actual_input", async () => {
    const user = userEvent.setup();
    renderDialog(zeroPlannedSession);

    const units = screen.getByLabelText(/实际课数/);
    await user.clear(units);
    await user.type(units, "2");

    // actual > planned 仍属「满额及以上」：不显示 defer。
    expect(
      screen.queryByRole("checkbox", { name: /剩余.*改到下次/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认完成" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalled();
    });

    const input = completeInvokeArgs();
    expect(input.actualUnits).toBe(2);
    expect(input.deferRemaining).toBe(false);
  });

  it("complete_dialog_zero_units_disables_defer", async () => {
    // B 段：可见性应为 actual > 0 && actual < planned；0 单位引导改期。
    const user = userEvent.setup();
    renderDialog();

    const units = screen.getByLabelText(/实际课数/);
    await user.clear(units);
    await user.type(units, "0");

    expect(
      screen.queryByRole("checkbox", { name: /剩余.*改到下次/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/改期/)).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: "确认完成" });
    expect(submit).not.toBeDisabled();

    await user.click(submit);

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalled();
    });

    const input = completeInvokeArgs();
    expect(input.actualUnits).toBe(0);
    expect(input.deferRemaining).toBe(false);
    expect(input.deferDate == null).toBe(true);
    expect(input.deferStart == null).toBe(true);
    expect(input.deferEnd == null).toBe(true);
  });

  it("complete_dialog_defer_reappears_when_units_become_positive", async () => {
    const user = userEvent.setup();
    renderDialog();

    const units = screen.getByLabelText(/实际课数/);
    await user.clear(units);
    await user.type(units, "0");
    expect(
      screen.queryByRole("checkbox", { name: /剩余.*改到下次/ }),
    ).not.toBeInTheDocument();

    await user.clear(units);
    await user.type(units, "2");

    const deferBox = screen.getByRole("checkbox", { name: /剩余.*改到下次/ });
    expect(deferBox).toBeEnabled();
    await user.click(deferBox);

    await user.click(screen.getByRole("button", { name: "确认完成" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalled();
    });

    const input = completeInvokeArgs();
    expect(input.actualUnits).toBe(2);
    expect(input.deferRemaining).toBe(true);
  });

  it("complete_dialog_backend_zero_defer_error_shows_friendly_message", async () => {
    // 后端 Result Err 经 to_string()：Display 文案（含 reschedule），非 JSON 对象。
    mockedInvoke.mockRejectedValue(
      "cannot defer remaining units when actual_units is 0; use reschedule instead",
    );

    const unhandled: unknown[] = [];
    const onUnhandled = (ev: PromiseRejectionEvent) => {
      unhandled.push(ev.reason);
      ev.preventDefault();
    };
    window.addEventListener("unhandledrejection", onUnhandled);

    const user = userEvent.setup();
    // 绕过 UI：父级强制 actual=0 + defer，模拟前端禁用失效。
    render(
      <CompleteDialog
        session={session}
        onClose={() => undefined}
        onSubmit={async () => {
          await api.completeSession({
            sessionId: session.id,
            actualUnits: 0,
            selfRating: 3,
            selfNote: null,
            method: "刷题",
            deferRemaining: true,
            deferDate: "2026-06-01",
            deferStart: "19:00",
            deferEnd: "20:00",
          });
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "确认完成" }));

    await waitFor(() => {
      expect(screen.getByText(/改期|未完成/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/ZeroUnitsCannotDefer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot defer remaining units/i)).not.toBeInTheDocument();
    // 弹窗仍在，可改后再提。
    expect(screen.getByRole("button", { name: "确认完成" })).toBeInTheDocument();
    expect(screen.getByLabelText(/实际课数/)).toBeInTheDocument();

    window.removeEventListener("unhandledrejection", onUnhandled);
    expect(unhandled).toHaveLength(0);
  });
});

const plannedThree: TaskSession = {
  ...session,
  id: 43,
  planned_units: 3,
};

/** 自评默认 3、streak 0、主线：5 单位 XP = 5*12 = 60；按计划封顶 3 单位则是 36。 */
const XP_FOR_FIVE_UNITS = 60;
const XP_IF_CAPPED_AT_PLANNED = 36;

function renderPlannedThree() {
  mockedInvoke.mockResolvedValue({
    session: { ...plannedThree, status: "done", actual_units: 5, xp_awarded: XP_FOR_FIVE_UNITS },
    xpAwarded: XP_FOR_FIVE_UNITS,
    newAchievements: [],
    createdSessionId: null,
    remainderSessionId: null,
  });
  return render(
    <CompleteDialog
      session={plannedThree}
      onClose={() => undefined}
      onSubmit={async (data) => {
        return api.completeSession({
          sessionId: plannedThree.id,
          actualUnits: data.actualUnits,
          selfRating: data.selfRating,
          selfNote: data.selfNote || null,
          method: data.method,
          deferRemaining: data.deferRemaining,
          deferDate: data.deferDate,
          deferStart: data.deferStart,
          deferEnd: data.deferEnd,
        });
      }}
    />,
  );
}

async function submitUnits(units: string) {
  const user = userEvent.setup();
  const input = screen.getByLabelText(/实际课数/);
  await user.clear(input);
  if (units !== "") {
    await user.type(input, units);
  }
  await user.click(screen.getByRole("button", { name: "确认完成" }));
  await waitFor(() => {
    expect(mockedInvoke).toHaveBeenCalled();
  });
}

describe("CompleteDialog overage hint", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("complete_dialog_shows_overage_hint_when_actual_exceeds_planned", async () => {
    renderPlannedThree();
    await submitUnits("5");

    const hint = await screen.findByRole("status");
    expect(hint).toHaveTextContent(/超额/);
    expect(hint).toHaveTextContent(/2\s*课/);
    expect(hint).toHaveTextContent(String(XP_FOR_FIVE_UNITS));
    expect(hint.className).toMatch(/emerald|green/);
    expect(hint.className).not.toMatch(/amber|red/);
    expect(hint.getAttribute("role")).not.toBe("alert");
  });

  it("complete_dialog_no_overage_hint_when_actual_equals_planned", async () => {
    renderPlannedThree();
    await submitUnits("3");
    expect(screen.queryByText(/超额/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("complete_dialog_no_overage_hint_when_actual_below_planned", async () => {
    renderPlannedThree();
    await submitUnits("2");
    expect(screen.queryByRole("checkbox", { name: /剩余.*改到下次/ })).toBeInTheDocument();
    expect(screen.queryByText(/超额/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("complete_dialog_overage_hint_shows_full_xp_from_actual_units", async () => {
    renderPlannedThree();
    await submitUnits("5");

    const hint = await screen.findByRole("status");
    expect(hint).toHaveTextContent(String(XP_FOR_FIVE_UNITS));
    expect(hint).not.toHaveTextContent(String(XP_IF_CAPPED_AT_PLANNED));
    const returned = await mockedInvoke.mock.results[0]!.value;
    expect(returned.xpAwarded).toBe(XP_FOR_FIVE_UNITS);
    expect(hint).toHaveTextContent(String(returned.xpAwarded));
  });
});

/** Set the raw string React's onChange receives, including values a number input would sanitize. */
function setActualUnitsRaw(raw: string) {
  const units = screen.getByLabelText(/实际课数/) as HTMLInputElement;
  fireEvent.input(units, { target: { value: raw } });
  return units;
}

describe("CompleteDialog actual_units validation", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue({
      session,
      xpAwarded: 0,
      newAchievements: [],
      createdSessionId: null,
      remainderSessionId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("complete_dialog_rejects_non_numeric_actual_units", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderDialog();

    setActualUnitsRaw("abc");

    expect(screen.getByText(/请输入数字/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认完成" })).toBeDisabled();
    expect(mockedInvoke).not.toHaveBeenCalled();

    const logged = errorSpy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).not.toMatch(/NaN/);
    errorSpy.mockRestore();
  });

  it("complete_dialog_rejects_negative_actual_units", () => {
    renderDialog();

    setActualUnitsRaw("-3");

    // 前端先拦住，不等后端 InvalidActualUnits 的英文原文。
    expect(screen.getByText(/不能为负数/)).toBeInTheDocument();
    expect(screen.queryByText(/actual_units must be >= 0/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认完成" })).toBeDisabled();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("complete_dialog_empty_input_treated_as_zero_not_submitted_silently", () => {
    // 选项 a：空输入禁用提交，不把 "" 静默解释成 0。
    // 显式输入 "0" 仍可提交，见 complete_dialog_zero_units_disables_defer。
    renderDialog();

    const units = setActualUnitsRaw("");

    expect(units.value).toBe("");
    expect(screen.getByText(/请输入课数/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认完成" })).toBeDisabled();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("complete_dialog_rejects_overlong_number", () => {
    renderDialog();

    const raw = "99999999999999999999";
    const units = setActualUnitsRaw(raw);

    expect(units.value).toBe(raw);
    expect(screen.getByText(/数值过大/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认完成" })).toBeDisabled();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("complete_dialog_decimal_input_behavior_documented", () => {
    // 选项 a：课数是整数。拒绝 3.7，不四舍五入成 4，也不截成 3。
    renderDialog();

    const units = setActualUnitsRaw("3.7");

    expect(units.value).toBe("3.7");
    expect(screen.getByText(/请输入整数/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认完成" })).toBeDisabled();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
