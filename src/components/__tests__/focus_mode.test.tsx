import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocusMode } from "../FocusMode";
import { FOCUS_LEAVE_MESSAGE } from "../../lib/focusClock";

function renderFocus(handlers?: {
  onComplete?: () => void;
  onAbandon?: () => void;
}) {
  const onComplete = handlers?.onComplete ?? vi.fn();
  const onAbandon = handlers?.onAbandon ?? vi.fn();
  const view = render(
    <FocusMode
      title="数学必修一 · 函数"
      durationMinutes={25}
      onComplete={onComplete}
      onAbandon={onAbandon}
    />,
  );
  return { ...view, onComplete, onAbandon };
}

describe("FocusMode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("focus_mode_shows_25_00_for_a_25_minute_session", () => {
    renderFocus();
    expect(screen.getByTestId("focus-clock")).toHaveTextContent("25:00");
    expect(screen.getByText("数学必修一 · 函数")).toBeInTheDocument();
  });

  it("focus_mode_ticks_down_one_minute", () => {
    renderFocus();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId("focus-clock")).toHaveTextContent("24:00");
  });

  it("focus_mode_early_complete_invokes_callback", () => {
    const onComplete = vi.fn();
    renderFocus({ onComplete });
    fireEvent.click(screen.getByRole("button", { name: "提前完成" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("focus_mode_abandon_unmounts_and_clears_leave_guard", () => {
    function Host() {
      const [open, setOpen] = useState(true);
      if (!open) return <div>已退出专注</div>;
      return (
        <FocusMode
          title="数学必修一 · 函数"
          durationMinutes={25}
          onComplete={() => undefined}
          onAbandon={() => setOpen(false)}
        />
      );
    }

    render(<Host />);
    expect(screen.getByTestId("focus-clock")).toBeInTheDocument();

    const leaving = new Event("beforeunload", {
      cancelable: true,
    }) as BeforeUnloadEvent;
    let prompted = "";
    Object.defineProperty(leaving, "returnValue", {
      configurable: true,
      get: () => prompted,
      set: (value: string) => {
        prompted = String(value);
      },
    });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    expect(prompted).toBe(FOCUS_LEAVE_MESSAGE);

    fireEvent.click(screen.getByRole("button", { name: "放弃" }));

    expect(screen.queryByTestId("focus-clock")).not.toBeInTheDocument();
    expect(screen.queryByTestId("focus-mode")).not.toBeInTheDocument();
    expect(screen.getByText("已退出专注")).toBeInTheDocument();

    const after = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(after)).toBe(true);
  });
});
