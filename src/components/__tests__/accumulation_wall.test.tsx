import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AccumulationWall } from "../AccumulationWall";
import { brickLabel } from "../../lib/accumulation";

const END = "2026-01-28";

const WEEK: { date: string; units: number; tone: string }[] = [
  { date: "2026-01-22", units: 0, tone: "bg-zinc-800" },
  { date: "2026-01-23", units: 1, tone: "bg-orange-900" },
  { date: "2026-01-24", units: 3, tone: "bg-orange-900" },
  { date: "2026-01-25", units: 4, tone: "bg-orange-600" },
  { date: "2026-01-26", units: 6, tone: "bg-orange-600" },
  { date: "2026-01-27", units: 7, tone: "bg-orange-400" },
  { date: "2026-01-28", units: 12, tone: "bg-orange-400" },
];

function brick(date: string): HTMLElement {
  const el = document.querySelector(`[data-date="${date}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`missing brick ${date}`);
  return el;
}

function renderWall(
  totals = WEEK.map(({ date, units }) => ({ date, units })),
  endDate = END,
) {
  return render(
    <MemoryRouter>
      <AccumulationWall endDate={endDate} totals={totals} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("AccumulationWall", () => {
  it("accumulation_wall_colors_match_unit_buckets", () => {
    renderWall();

    expect(screen.getByText("你的一砖一瓦，正在垒成城堡。")).toBeInTheDocument();
    const dates = [...document.querySelectorAll("[data-date]")].map((el) =>
      el.getAttribute("data-date"),
    );
    expect(dates).toHaveLength(28);
    expect(dates[0]).toBe("2026-01-01");
    expect(dates[27]).toBe("2026-01-28");

    for (const day of WEEK) {
      const cell = brick(day.date);
      expect(cell).toHaveClass(day.tone);
      expect(cell).toHaveAttribute("title", brickLabel(day.date, day.units));
    }

    const today = document.querySelector('[data-today="true"]');
    expect(today).toHaveAttribute("data-date", END);
    expect(today).toHaveClass("ring-1", "ring-orange-500");
    expect(screen.queryByRole("link", { name: "今天还是空的，开始第一课吧！" })).not.toBeInTheDocument();
    for (const label of ["Mon", "Wed", "Fri"]) {
      expect(screen.getByText(label)).toHaveClass("text-[10px]", "text-zinc-500");
    }
  });

  it("accumulation_wall_zero_units_is_zinc_800", () => {
    renderWall([{ date: "2026-01-22", units: 0 }]);

    const explicit = brick("2026-01-22");
    expect(explicit).toHaveClass("bg-zinc-800");
    expect(explicit).not.toHaveClass("bg-orange-900");
    expect(explicit).toHaveAttribute("title", "2026-01-22 · 完成 0");

    const missing = brick("2026-01-21");
    expect(missing).toHaveClass("bg-zinc-800");
    expect(missing).toHaveAttribute("title", "2026-01-21 · 完成 0");

    const today = document.querySelector('[data-today="true"]');
    expect(today).toHaveClass("ring-1", "ring-zinc-500");
    expect(screen.getByRole("link", { name: "今天还是空的，开始第一课吧！" })).toHaveAttribute(
      "href",
      "/today",
    );
  });

  it("accumulation_wall_month_labels_when_range_crosses", () => {
    renderWall([], "2026-11-05");

    expect(screen.getByText("10月")).toHaveClass("text-[10px]", "text-zinc-500");
    expect(screen.getByText("11月")).toHaveClass("text-[10px]", "text-zinc-500");
    expect(screen.getByRole("link", { name: "今天还是空的，开始第一课吧！" })).toBeInTheDocument();
  });
});