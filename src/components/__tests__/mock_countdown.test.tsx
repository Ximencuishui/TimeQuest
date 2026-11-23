import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockCountdown } from "../MockCountdown";
import { makeGoal, setGoalFixtures } from "../../test/mockGoals";

vi.mock("../../hooks/useGoals", async () => await import("../../test/mockGoals"));

const goals = [
  makeGoal({ id: 1, name: "高考", date: "2027-06-07", isPrimary: true }),
  makeGoal({ id: 2, name: "第一次模考", date: "2026-11-25", isPrimary: false }),
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 18, 12, 0, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MockCountdown", () => {
  it("mock_countdown_shows_days_until_next_mock_exam", () => {
    setGoalFixtures(goals);

    render(<MockCountdown />);

    const box = screen.getByTestId("mock-countdown");
    expect(box).toHaveTextContent("距离 第一次模考");
    expect(box).toHaveTextContent("7 天");
    expect(box).toHaveTextContent("2026-11-25");
  });

  it("mock_countdown_hides_when_there_is_no_mock_exam", () => {
    setGoalFixtures([goals[0]!]);

    render(<MockCountdown />);

    expect(screen.queryByTestId("mock-countdown")).not.toBeInTheDocument();
  });
});
