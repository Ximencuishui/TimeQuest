import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExamRecord } from "../../types";
import { ScoreTrendChart } from "../ScoreTrendChart";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
      <div data-testid="responsive-container" style={{ width: 480, height: 288 }}>
        {Children.map(children, (child) => {
          if (!isValidElement(child)) return child;
          return cloneElement(child as ReactElement<{ width?: number; height?: number }>, {
            width: 480,
            height: 288,
          });
        })}
      </div>
    ),
  };
});

function sitting(
  id: number,
  name: string,
  date: string,
  scores: [number, number, number, number, number, number],
): ExamRecord {
  const [chinese, math, english, physics, chemistry, biology] = scores;
  return {
    id,
    exam_name: name,
    exam_date: date,
    chinese_score: chinese,
    math_score: math,
    english_score: english,
    physics_score: physics,
    chemistry_score: chemistry,
    biology_score: biology,
    created_at: `${date} 12:00:00`,
  };
}

const RECORDS: ExamRecord[] = [
  sitting(3, "一模", "2026-11-01", [118, 135, 118, 82, 80, 80]),
  sitting(1, "月考", "2026-09-01", [100, 120, 100, 70, 70, 70]),
  sitting(2, "期中", "2026-10-01", [110, 125, 110, 75, 75, 75]),
];

const TARGETS = {
  total: 600,
  chinese: 120,
  math: 130,
  english: 120,
  physics: 80,
  chemistry: 80,
  biology: 80,
};

describe("Score trend chart", () => {
  afterEach(() => {
    cleanup();
  });

  it("draws the total target line and switches the series with the subject tab", () => {
    const { container } = render(
      <ScoreTrendChart records={RECORDS} targets={TARGETS} />,
    );

    expect(container.querySelector(".recharts-reference-line-line")).toBeInTheDocument();
    expect(screen.getByText("目标 600")).toBeInTheDocument();
    expect(screen.getByTestId("score-trend-chart")).toHaveAttribute(
      "data-scores",
      "530,570,613",
    );
    expect(screen.getByRole("tab", { name: "总分" })).toHaveAttribute("aria-selected", "true");
    const totalStrokes = [...container.querySelectorAll(".recharts-line-curve")].map((node) =>
      node.getAttribute("stroke"),
    );
    expect(totalStrokes).toContain("#f97316");
    expect(totalStrokes).toContain("#4ade80");

    fireEvent.click(screen.getByRole("tab", { name: "数学" }));

    expect(screen.getByRole("tab", { name: "数学" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "总分" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("目标 130")).toBeInTheDocument();
    expect(screen.queryByText("目标 600")).not.toBeInTheDocument();
    expect(container.querySelector(".recharts-reference-line-line")).toBeInTheDocument();
    expect(screen.getByTestId("score-trend-chart")).toHaveAttribute(
      "data-scores",
      "120,125,135",
    );
  });

  it("omits the reference line when the total or subject target is missing", () => {
    const { container } = render(
      <ScoreTrendChart
        records={RECORDS}
        targets={{ ...TARGETS, total: null, math: null }}
      />,
    );

    expect(screen.getByTestId("score-trend-chart")).toHaveAttribute(
      "data-scores",
      "530,570,613",
    );
    expect(container.querySelector(".recharts-reference-line-line")).not.toBeInTheDocument();
    expect(screen.queryByText(/目标 /)).not.toBeInTheDocument();
    expect(screen.getByText(/还没有总分目标/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "数学" }));

    expect(screen.getByTestId("score-trend-chart")).toHaveAttribute(
      "data-scores",
      "120,125,135",
    );
    expect(container.querySelector(".recharts-reference-line-line")).not.toBeInTheDocument();
    expect(screen.getByText(/还没有数学目标/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "语文" }));

    expect(screen.getByText("目标 120")).toBeInTheDocument();
    expect(container.querySelector(".recharts-reference-line-line")).toBeInTheDocument();
  });

  it("keeps a zero score inside the axis and skips an unfilled subject", () => {
    const zero = sitting(1, "零分", "2026-09-01", [0, 0, 0, 0, 0, 0]);
    const skipped: ExamRecord = {
      ...sitting(2, "缺数学", "2026-10-01", [10, 0, 10, 10, 10, 10]),
      math_score: null,
    };
    const { container } = render(
      <ScoreTrendChart records={[skipped, zero]} targets={TARGETS} />,
    );

    const chart = screen.getByTestId("score-trend-chart");
    expect(chart).toHaveAttribute("data-scores", "0,null");
    const [low, high] = chart.getAttribute("data-domain")!.split(",").map(Number);
    expect(low).toBeLessThan(0);
    expect(high).toBeGreaterThan(600);
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
    expect(screen.getByText("目标 600")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|Infinity/);

    fireEvent.click(screen.getByRole("tab", { name: "数学" }));

    expect(chart).toHaveAttribute("data-scores", "0,null");
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("lifts the axis above a target that is higher than every score", () => {
    const modest = sitting(1, "月考", "2026-09-01", [80, 80, 80, 60, 50, 50]);
    render(<ScoreTrendChart records={[modest]} targets={TARGETS} />);

    const chart = screen.getByTestId("score-trend-chart");
    expect(chart).toHaveAttribute("data-scores", "400");
    const [low, high] = chart.getAttribute("data-domain")!.split(",").map(Number);
    expect(low).toBeLessThan(400);
    expect(high).toBeGreaterThan(600);
    expect(screen.getByText("目标 600")).toBeInTheDocument();
  });

  it("renders the single plotted point when only one exam exists", () => {
    const only = sitting(1, "月考", "2026-09-01", [100, 120, 100, 70, 70, 70]);
    const { container } = render(<ScoreTrendChart records={[only]} targets={TARGETS} />);

    expect(screen.getByTestId("score-trend-chart")).toHaveAttribute("data-scores", "530");
    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(container.querySelector(".recharts-reference-line-line")).toBeInTheDocument();
    expect(screen.getByText("目标 600")).toBeInTheDocument();
    expect(container.querySelector(".recharts-line-curve")).not.toBeInTheDocument();
  });
});
