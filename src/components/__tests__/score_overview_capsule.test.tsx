import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { ExamRecord } from "../../types";
import { ScoreOverviewCapsule } from "../ScoreOverviewCapsule";

function sitting(
  id: number,
  date: string,
  scores: [number | null, number | null, number | null, number | null, number | null, number | null],
): ExamRecord {
  const [chinese, math, english, physics, chemistry, biology] = scores;
  return {
    id,
    exam_name: `考试${id}`,
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

function renderCapsule(records: ExamRecord[], totalTarget: number | null) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={<ScoreOverviewCapsule records={records} totalTarget={totalTarget} />}
        />
        <Route path="/scores" element={<h1>成绩档案</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Score overview capsule", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a green surplus when the latest total beats the target", () => {
    renderCapsule([sitting(1, "2026-11-01", [118, 135, 118, 82, 80, 80])], 600);

    const badge = screen.getByText("+13 分");
    expect(badge).toHaveClass("bg-green-500/20", "text-green-400");
    expect(screen.getByText("最近成绩：")).toBeInTheDocument();
    expect(screen.getByText("613")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /最近成绩/ }));
    expect(screen.getByRole("heading", { name: "成绩档案" })).toBeInTheDocument();
  });

  it("shows an orange deficit when the latest total is under the target", () => {
    renderCapsule([sitting(1, "2026-10-01", [110, 125, 110, 75, 75, 75])], 600);

    const badge = screen.getByText("-30 分");
    expect(badge).toHaveClass("bg-orange-500/20", "text-orange-400");
    expect(screen.getByText("570")).toBeInTheDocument();
  });

  it("renders nothing when there are no exam records", () => {
    const { container } = renderCapsule([], 600);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/最近/)).not.toBeInTheDocument();
  });

  it("shows the score without a comparison when the total target is unset", () => {
    renderCapsule([sitting(1, "2026-11-01", [118, 135, 118, 82, 80, 80])], null);

    expect(screen.getByText("613")).toBeInTheDocument();
    expect(screen.queryByText(/分$/)).not.toBeInTheDocument();
    expect(document.querySelector(".bg-green-500\\/20")).not.toBeInTheDocument();
    expect(document.querySelector(".bg-orange-500\\/20")).not.toBeInTheDocument();
  });

  it("names the subject when the latest exam only has one score", () => {
    const older = sitting(1, "2026-09-01", [118, 135, 118, 82, 80, 80]);
    const newer = sitting(2, "2026-11-01", [null, 135, null, null, null, null]);
    renderCapsule([older, newer], 600);

    expect(screen.getByText("最近单科：")).toBeInTheDocument();
    expect(screen.getByText("数学 135")).toBeInTheDocument();
    expect(screen.queryByText("+13 分")).not.toBeInTheDocument();
    expect(screen.queryByText("-30 分")).not.toBeInTheDocument();
  });
});
