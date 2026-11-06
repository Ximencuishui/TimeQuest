import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Stats } from "../index";

/** Recharts charts need explicit width/height; real ResponsiveContainer measures DOM. */
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
      <div data-testid="responsive-container" style={{ width: 400, height: 300 }}>
        {Children.map(children, (child) => {
          if (!isValidElement(child)) return child;
          return cloneElement(child as ReactElement<{ width?: number; height?: number }>, {
            width: 400,
            height: 300,
          });
        })}
      </div>
    ),
  };
});

const mockedInvoke = vi.mocked(invoke);

function emptyStatsInvoke(cmd: string) {
  switch (cmd) {
    case "stats_plan_vs_actual":
      return [];
    case "stats_method_share":
      return [];
    case "stats_tag_type_totals":
      return [];
    case "stats_completion_rate":
      // Real shape (not { total }); rate=0 when denominator is 0.
      return { done: 0, missed: 0, rescheduled: 0, rate: 0 };
    case "stats_avg_ratings":
      return [];
    default:
      return null;
  }
}

function renderStats() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <Stats />
    </QueryClientProvider>,
  );
}

describe("Stats page charts", () => {
  let consoleErrors: string[];

  beforeEach(() => {
    consoleErrors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(" "));
    });
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.mocked(console.error).mockRestore();
  });

  it("stats_page_empty_charts_render_without_crash", async () => {
    mockedInvoke.mockImplementation(async (cmd) => emptyStatsInvoke(String(cmd)));

    expect(() => renderStats()).not.toThrow();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "统计" })).toBeInTheDocument();
    });

    expect(
      screen.getByRole("heading", { name: "计划 vs 实际（分钟）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "学习方式占比" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "各科目投入占比" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("这段时间还没有学习记录，去开启一个番茄钟吧。"),
    ).toHaveLength(3);
    expect(screen.getByText("暂无自评数据")).toBeInTheDocument();
    expect(screen.getAllByTestId("chart-empty-state").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByTestId("plan-vs-actual-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId("method-share-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId("subject-share-chart")).not.toBeInTheDocument();

    const bad = consoleErrors.filter((msg) =>
      /cannot read propert|undefined is not an object|is not a function/i.test(
        msg,
      ),
    );
    expect(bad).toEqual([]);
  });

  it("stats_page_empty_does_not_divide_by_zero", async () => {
    mockedInvoke.mockImplementation(async (cmd) => emptyStatsInvoke(String(cmd)));

    renderStats();

    await waitFor(() => {
      expect(screen.getByText("0%")).toBeInTheDocument();
    });

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/\bNaN\b/);
    expect(body).not.toMatch(/\bInfinity\b/);
  });

  it("stats_page_single_item_charts_render", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      const c = String(cmd);
      if (c === "stats_method_share") {
        return [{ method: "刷题", duration_min: 40 }];
      }
      if (c === "stats_plan_vs_actual") {
        return [{ subject: "数学", planned_min: 60, actual_min: 45 }];
      }
      return emptyStatsInvoke(c);
    });

    renderStats();

    await waitFor(() => {
      expect(screen.getByText("刷题 · 40 分")).toBeInTheDocument();
    });
    expect(screen.getByTestId("method-share-chart")).toBeInTheDocument();
    expect(screen.getByTestId("plan-vs-actual-chart")).toBeInTheDocument();
    expect(screen.getByTestId("subject-share-chart")).toBeInTheDocument();
    expect(screen.queryAllByText("暂无方式数据")).toHaveLength(0);

    await waitFor(() => {
      const methodChart = screen.getByTestId("method-share-chart");
      const sectors = methodChart.querySelectorAll(
        ".recharts-pie-sector, .recharts-sector",
      );
      expect(sectors.length).toBe(1);
    });

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/\bNaN\b/);
    expect(body).not.toMatch(/\bInfinity\b/);
  });
});
