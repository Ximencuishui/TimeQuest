import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_DAILY_STUDY_MINUTES } from "../../lib/constants";
import { StudyRemaining } from "../StudyRemaining";

describe("StudyRemaining 防呆提示", () => {
  afterEach(() => {
    cleanup();
  });
  it("study_remaining_merges_overlapping_sessions_and_explains", () => {
    render(
      <StudyRemaining
        sessions={[
          { status: "planned", start_time: "19:00", end_time: "20:00", task_title: "英语必修一" },
          { status: "planned", start_time: "19:00", end_time: "20:00", task_title: "数学必修一" },
        ]}
        now={new Date(2026, 10, 6, 18, 0, 0)}
      />,
    );

    const box = screen.getByTestId("today-remaining");
    expect(box).toHaveTextContent("今日剩余待学 01:00:00");
    expect(box).toHaveTextContent("1 场时间重叠，已按实际时段合并");
    expect(box).not.toHaveTextContent("02:00:00");
  });

  it("study_remaining_caps_daily_total_and_explains", () => {
    const sessions = Array.from({ length: 24 }, (_, hour) => ({
      status: "planned",
      start_time: `${String(hour).padStart(2, "0")}:00`,
      end_time: `${String(hour).padStart(2, "0")}:59`,
    }));

    render(<StudyRemaining sessions={sessions} now={new Date(2026, 10, 6, 0, 0, 0)} />);

    const box = screen.getByTestId("today-remaining");
    expect(box).toHaveTextContent(
      `今日剩余待学 ${String(MAX_DAILY_STUDY_MINUTES / 60).padStart(2, "0")}:00:00`,
    );
    expect(box).toHaveTextContent(`已按每日 ${MAX_DAILY_STUDY_MINUTES / 60} 小时上限计`);
  });

  it("study_remaining_stays_plain_when_no_overlap", () => {
    render(
      <StudyRemaining
        sessions={[{ status: "planned", start_time: "19:00", end_time: "20:00" }]}
        now={new Date(2026, 10, 6, 18, 0, 0)}
      />,
    );

    const box = screen.getByTestId("today-remaining");
    expect(box).toHaveTextContent("今日剩余待学 01:00:00");
    expect(box).not.toHaveTextContent("已按实际时段合并");
    expect(box).not.toHaveTextContent("上限计");
  });
});
