import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodayTimeline } from "../../../components/TodayTimeline";
import type { TaskSession } from "../../../types";

function session(
  partial: Partial<TaskSession> &
    Pick<TaskSession, "id" | "start_time" | "end_time">,
): TaskSession {
  return {
    task_id: 1,
    date: "2026-11-06",
    round: 1,
    status: "planned",
    planned_units: 2,
    actual_units: 0,
    self_rating: null,
    self_note: null,
    rescheduled_to: null,
    xp_awarded: 0,
    created_at: "2026-11-06 08:00:00",
    task_title: `场次 ${partial.id}`,
    task_type: "main",
    ...partial,
  };
}

function renderTimeline(sessions: TaskSession[], now: Date) {
  return render(
    <TodayTimeline
      sessions={sessions}
      now={now}
      timeAware
      onComplete={() => undefined}
      onReschedule={() => undefined}
    />,
  );
}

function cardFor(id: number): HTMLElement {
  const el = document.querySelector(`[data-session-id="${id}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`missing card ${id}`);
  return el;
}

afterEach(() => {
  cleanup();
});

describe("Today timeline", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("marks past and upcoming sessions by wall clock at 10:00", () => {
    const now = new Date(2026, 10, 6, 10, 0, 0);
    renderTimeline(
      [
        session({
          id: 1,
          start_time: "09:00",
          end_time: "10:00",
          task_title: "九点场",
        }),
        session({
          id: 2,
          start_time: "10:30",
          end_time: "11:30",
          task_title: "十点半场",
        }),
        session({
          id: 3,
          start_time: "08:00",
          end_time: "09:00",
          task_title: "八点场",
        }),
      ],
      now,
    );

    // 10:30–11:30 still upcoming: normal dark surface, not dimmed
    const upcoming = cardFor(2);
    expect(upcoming).toHaveAttribute("data-time-phase", "upcoming");
    expect(upcoming.className).toContain("bg-surface-2/90");
    expect(upcoming.className).not.toContain("opacity-50");
    expect(upcoming.className).not.toContain("border-orange-500");

    // 08:00–09:00 already past
    const past = cardFor(3);
    expect(past).toHaveAttribute("data-time-phase", "past");
    expect(past.className).toContain("opacity-50");
    expect(screen.getByText("八点场").className).toContain("text-zinc-500");
  });

  it("highlights the in-progress session with orange border, pulse, and badge", () => {
    const now = new Date(2026, 10, 6, 10, 0, 0);
    renderTimeline(
      [
        session({
          id: 10,
          start_time: "09:30",
          end_time: "10:30",
          task_title: "进行中场",
        }),
      ],
      now,
    );

    const active = cardFor(10);
    expect(active).toHaveAttribute("data-time-phase", "active");
    expect(active.className).toContain("border-orange-500");
    expect(active.className).toContain("animate-pulse");
    expect(active.className).toContain("bg-orange-500/10");
    expect(screen.getByTestId("active-badge")).toHaveTextContent("进行中");
    expect(screen.getByText("进行中")).toBeInTheDocument();

    const dot = screen.getByTestId("timeline-dot-10");
    expect(dot.className).toContain("bg-orange-500");
  });

  it("renders hour ticks along the timeline", () => {
    const now = new Date(2026, 10, 6, 10, 0, 0);
    renderTimeline(
      [
        session({ id: 1, start_time: "09:00", end_time: "10:00" }),
        session({ id: 2, start_time: "10:30", end_time: "11:30" }),
        session({ id: 3, start_time: "08:00", end_time: "09:00" }),
      ],
      now,
    );

    const ticks = screen.getAllByTestId("timeline-tick").map((el) => el.textContent);
    expect(ticks).toEqual(["08:00", "09:00", "10:00"]);
  });
});
