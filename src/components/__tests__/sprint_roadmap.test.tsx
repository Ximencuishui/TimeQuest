import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { RoadmapTask } from "../../lib/roadmap";
import { SprintRoadmap } from "../SprintRoadmap";

function task(partial: Partial<RoadmapTask>): RoadmapTask {
  return {
    id: 1,
    title: "数学必修一",
    type: "main",
    subject: "数学",
    textbook: "必修一",
    unit_name: "课",
    total_units: 10,
    total_rounds: 3,
    current_round: 1,
    color: "#F97316",
    archived: 0,
    created_at: "2026-01-01 00:00:00",
    ...partial,
  };
}

function renderRoadmap(tasks: RoadmapTask[]) {
  return render(
    <MemoryRouter>
      <SprintRoadmap tasks={tasks} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("SprintRoadmap", () => {
  it("renders two nodes and one marker for two main tasks", () => {
    renderRoadmap([
      task({ id: 1, title: "数学必修一", actual_units_sum: 10, created_at: "2026-01-01 00:00:00" }),
      task({ id: 2, title: "英语词汇", actual_units_sum: 3, created_at: "2026-01-02 00:00:00" }),
    ]);

    expect(screen.getByRole("region", { name: "冲刺航线" })).toBeInTheDocument();
    expect(screen.getByText("冲刺航线")).toBeInTheDocument();
    expect(screen.getAllByTestId("roadmap-node")).toHaveLength(2);
    expect(screen.getAllByTestId("roadmap-marker")).toHaveLength(1);
    expect(screen.getByText("数学必修一")).toBeInTheDocument();
    expect(screen.getByText("英语词汇")).toBeInTheDocument();
    expect(screen.getByText("1/2 主线通关")).toBeInTheDocument();
    const nodes = screen.getAllByTestId("roadmap-node");
    expect(nodes[0].getAttribute("data-status")).toBe("done");
    expect(nodes[1].getAttribute("data-status")).toBe("active");
  });

  it("shows empty guidance when there are no main tasks", () => {
    renderRoadmap([
      task({ id: 3, title: "运动", type: "side" }),
      task({ id: 4, title: "旧主线", archived: 1 }),
    ]);

    expect(screen.getByText("设定你的第一个主线任务，开启冲刺航线。")).toBeInTheDocument();
    expect(screen.queryByTestId("roadmap-node")).not.toBeInTheDocument();
    expect(screen.queryByTestId("roadmap-marker")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去创建" })).toHaveAttribute("href", "/tasks");
  });

  it("caps at four main nodes", () => {
    renderRoadmap([
      task({ id: 1, created_at: "2026-01-01 00:00:00" }),
      task({ id: 2, title: "二", created_at: "2026-01-02 00:00:00" }),
      task({ id: 3, title: "三", created_at: "2026-01-03 00:00:00" }),
      task({ id: 4, title: "四", created_at: "2026-01-04 00:00:00" }),
      task({ id: 5, title: "五", created_at: "2026-01-05 00:00:00" }),
    ]);
    expect(screen.getAllByTestId("roadmap-node")).toHaveLength(4);
    expect(screen.queryByText("五")).not.toBeInTheDocument();
  });
});
