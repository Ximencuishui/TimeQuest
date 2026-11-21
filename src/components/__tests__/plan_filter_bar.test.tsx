import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanFilterBar } from "../PlanFilterBar";
import { emptyPlanFilter, type PlanFilter, type PlanTags } from "../../lib/planViews";

const TAGS: PlanTags = {
  subjects: ["数学", "物理"],
  textbooks: ["人教A版"],
  rounds: [1, 2],
};

function renderBar(
  filter: PlanFilter = emptyPlanFilter(),
  onChange = vi.fn(),
  matchedCount = 2,
  totalCount = 3,
) {
  render(
    <PlanFilterBar
      tags={TAGS}
      filter={filter}
      onChange={onChange}
      matchedCount={matchedCount}
      totalCount={totalCount}
    />,
  );
  return onChange;
}

describe("PlanFilterBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("plan_filter_bar_shows_subject_textbook_and_round_tags", () => {
    renderBar();

    expect(screen.getByTestId("plan-filter-subjects-数学")).toBeInTheDocument();
    expect(screen.getByTestId("plan-filter-subjects-物理")).toBeInTheDocument();
    expect(screen.getByTestId("plan-filter-textbooks-人教A版")).toBeInTheDocument();
    expect(screen.getByTestId("plan-filter-rounds-1")).toHaveTextContent("第1轮");
    expect(screen.getByTestId("plan-filter-rounds-2")).toHaveTextContent("第2轮");
    // 轮次标签不能被当成 checkbox，全局 checkbox 计数有别的测试钉着。
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("plan_filter_bar_toggles_a_tag_on_and_off", () => {
    const onChange = renderBar();

    fireEvent.click(screen.getByTestId("plan-filter-subjects-数学"));

    expect(onChange).toHaveBeenCalledWith({
      ...emptyPlanFilter(),
      subjects: ["数学"],
    });
  });

  it("plan_filter_bar_marks_the_selected_tags", () => {
    renderBar({ subjects: ["数学"], textbooks: [], rounds: [2] });

    expect(screen.getByTestId("plan-filter-subjects-数学")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("plan-filter-subjects-物理")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("plan-filter-rounds-2")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("plan_filter_bar_reports_the_hit_count_and_clears", () => {
    const onChange = renderBar({ subjects: ["数学"], textbooks: [], rounds: [] }, vi.fn(), 1, 3);

    expect(screen.getByText("命中 1 / 3 个任务")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清空筛选" }));

    expect(onChange).toHaveBeenCalledWith(emptyPlanFilter());
  });
});
