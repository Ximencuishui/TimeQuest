import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskSession } from "../../types";
import { CalendarView } from "../CalendarView";

function session(
  partial: Partial<TaskSession> & Pick<TaskSession, "id" | "date">,
): TaskSession {
  return {
    task_id: 1,
    start_time: "09:00",
    end_time: "10:00",
    round: 1,
    status: "planned",
    planned_units: 1,
    actual_units: 0,
    self_rating: null,
    self_note: null,
    rescheduled_to: null,
    xp_awarded: 0,
    created_at: "2026-11-01 08:00:00",
    task_title: `场次 ${partial.id}`,
    task_type: "main",
    task_color: "#F97316",
    ...partial,
  };
}

const month = new Date(2026, 10, 1);

function renderCalendar(
  sessions: TaskSession[],
  extras?: Partial<ComponentProps<typeof CalendarView>>,
) {
  const onOpenDay = vi.fn();
  const onSelectDate = vi.fn();
  const onCreate = vi.fn();
  render(
    <CalendarView
      month={month}
      today="2026-11-06"
      sessions={sessions}
      selectedDate={null}
      onPrevMonth={() => undefined}
      onNextMonth={() => undefined}
      onToday={() => undefined}
      onOpenDay={onOpenDay}
      onSelectDate={onSelectDate}
      onCreate={onCreate}
      {...extras}
    />,
  );
  return { onOpenDay, onSelectDate, onCreate };
}

afterEach(() => {
  cleanup();
});

describe("CalendarView", () => {
  it("renders one dot per session, capping at 3 with +N", () => {
    renderCalendar([
      session({ id: 1, date: "2026-11-03", task_color: "#14B8A6" }),
      session({ id: 2, date: "2026-11-10", start_time: "08:00" }),
      session({ id: 3, date: "2026-11-10", start_time: "09:00" }),
      session({ id: 4, date: "2026-11-10", start_time: "10:00" }),
      session({ id: 5, date: "2026-11-10", start_time: "11:00" }),
      session({ id: 6, date: "2026-10-31" }),
    ]);

    expect(screen.getByTestId("calendar-month-label")).toHaveTextContent(
      "2026年 11月",
    );
    expect(
      screen.getByTestId("calendar-view").querySelector(".grid-cols-7"),
    ).not.toBeNull();

    const quiet = screen.getByTestId("calendar-day-2026-11-03");
    expect(quiet).toHaveAttribute("data-dot-count", "1");
    const quietDots = quiet.querySelectorAll("[data-testid='calendar-dot']");
    expect(quietDots).toHaveLength(1);
    expect(quietDots[0]).toHaveAttribute("data-color", "#14B8A6");
    expect(quiet.querySelector("[data-testid='calendar-more']")).toBeNull();

    const busy = screen.getByTestId("calendar-day-2026-11-10");
    expect(busy).toHaveAttribute("data-dot-count", "4");
    expect(busy.querySelectorAll("[data-testid='calendar-dot']")).toHaveLength(3);
    expect(busy.querySelector("[data-testid='calendar-more']")).toHaveTextContent(
      "+1",
    );

    const empty = screen.getByTestId("calendar-day-2026-11-02");
    expect(empty).toHaveAttribute("data-dot-count", "0");
    expect(empty.querySelector("[data-testid='calendar-dot']")).toBeNull();

    const today = screen.getByTestId("calendar-day-2026-11-06");
    expect(today).toHaveAttribute("data-today", "true");
    expect(today.querySelector(".bg-accent")).not.toBeNull();

    expect(screen.getByTestId("calendar-day-2026-10-26")).toHaveAttribute(
      "data-outside",
      "true",
    );
    expect(screen.getByTestId("calendar-day-2026-10-31")).toHaveAttribute(
      "data-dot-count",
      "1",
    );
  });

  it("lists that day's sessions under a past cell and opens the timeline for today", () => {
    const sessions = [
      session({ id: 2, date: "2026-11-10", start_time: "08:00", task_title: "早课" }),
      session({
        id: 5,
        date: "2026-11-10",
        start_time: "11:00",
        end_time: "12:00",
        task_title: "第四节",
      }),
    ];
    const closed = renderCalendar(sessions);
    fireEvent.click(screen.getByTestId("calendar-day-2026-11-06"));
    expect(closed.onOpenDay).toHaveBeenCalledWith("2026-11-06");
    expect(closed.onSelectDate).not.toHaveBeenCalled();

    cleanup();
    const open = renderCalendar(sessions, { selectedDate: "2026-11-10" });
    const panel = screen.getByTestId("calendar-day-panel");
    expect(panel).toHaveTextContent("2026-11-10 的排期");
    expect(panel).toHaveTextContent("08:00–10:00");
    expect(panel).toHaveTextContent("早课");
    expect(panel).toHaveTextContent("11:00–12:00");
    expect(panel).toHaveTextContent("第四节");
    fireEvent.click(screen.getByRole("button", { name: "在这天新建排期" }));
    expect(open.onCreate).toHaveBeenCalledWith("2026-11-10");
  });
});
