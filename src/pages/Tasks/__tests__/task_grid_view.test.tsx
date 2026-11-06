import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { TaskGridView, type GridTask } from "../../../components/TaskGridView";

function task(partial: Partial<GridTask>): GridTask {
  return {
    id: 1,
    title: "数学一轮",
    type: "main",
    subject: "数学",
    textbook: "必修一",
    unit_name: "课",
    total_units: 10,
    total_rounds: 3,
    current_round: 2,
    color: "#F97316",
    archived: 0,
    created_at: "2026-01-01 00:00:00",
    ...partial,
  };
}

function renderGrid(tasks: GridTask[]) {
  return render(
    <MemoryRouter>
      <TaskGridView tasks={tasks} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("TaskGridView", () => {
  it("task_grid_view_lights_four_of_ten_cells", () => {
    renderGrid([task({ total_units: 10, current_round_units: 4 })]);

    const cells = screen.getAllByTestId("micro-cell");
    expect(cells).toHaveLength(10);
    expect(cells.filter((cell) => cell.className.includes("bg-orange-500"))).toHaveLength(4);
    expect(cells.filter((cell) => cell.className.includes("bg-zinc-800"))).toHaveLength(6);
    expect(screen.getByText("数学一轮")).toBeInTheDocument();
    expect(screen.getByText(/必修一/)).toBeInTheDocument();
    expect(screen.getByText(/第 2 \/ 3 轮/)).toBeInTheDocument();
    expect(screen.getByText(/每格 1 课/)).toBeInTheDocument();
    expect(screen.queryByTestId("side-task-icon")).not.toBeInTheDocument();
  });

  it("task_grid_view_side_task_shows_icon_without_micro_grid", () => {
    renderGrid([
      task({
        id: 2,
        title: "英语听力",
        type: "side",
        subject: null,
        textbook: null,
        total_units: null,
        current_round_units: 6,
      }),
    ]);

    expect(screen.queryByTestId("micro-cell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("micro-grid")).not.toBeInTheDocument();
    expect(screen.getByTestId("side-task-icon")).toBeInTheDocument();
    expect(screen.getByText("累计完成")).toBeInTheDocument();
    expect(screen.getByText("6 课")).toBeInTheDocument();
  });

  it("task_grid_view_caps_cells_at_50", () => {
    renderGrid([task({ total_units: 200, current_round_units: 8 })]);

    const cells = screen.getAllByTestId("micro-cell");
    expect(cells.length).toBeLessThanOrEqual(50);
    expect(cells).toHaveLength(50);
    expect(screen.getByText(/每格 4 课/)).toBeInTheDocument();
    expect(screen.getByText(/已完成 8\/200 课/)).toBeInTheDocument();
    expect(cells.filter((cell) => cell.className.includes("bg-orange-500"))).toHaveLength(2);
  });
});