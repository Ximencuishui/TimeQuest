import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("stats_page_report_dialog_renders_focus_and_gap", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const previousClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    mockedInvoke.mockImplementation(async (cmd) => {
      const c = String(cmd);
      if (c === "stats_plan_vs_actual") {
        return [
          { subject: "数学", planned_min: 600, actual_min: 600 },
          { subject: "英语", planned_min: 300, actual_min: 60 },
        ];
      }
      if (c === "stats_tag_type_totals") {
        return [{ tag_type: "study", duration_min: 660 }];
      }
      if (c === "stats_daily_units") {
        return [{ date: "2026-11-02", units: 8 }];
      }
      if (c === "get_user_stats") {
        return {
          id: 1,
          total_xp: 40,
          current_level: 1,
          current_streak: 4,
          longest_streak: 9,
          last_done_date: "2026-11-06",
        };
      }
      return emptyStatsInvoke(c);
    });

    try {
      renderStats();

      const open = await screen.findByRole("button", { name: "生成复盘报告" });
      await waitFor(() => expect(open).toBeEnabled());
      fireEvent.click(open);

      const dialog = await screen.findByRole("dialog");
      const text = dialog.textContent ?? "";
      expect(text).toContain("数学依然是你最专注的阵地");
      expect(text).toContain("注意");
      expect(text).toContain("完成了 8 课");
      expect(text).toContain("目前你已连续打卡 4 天");
      expect(screen.getByRole("button", { name: "复制文本" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "复制文本" }));
      await waitFor(() => expect(writeText).toHaveBeenCalled());
      const copied = String(writeText.mock.calls[0]?.[0] ?? "").replace(/\*\*/g, "");
      expect(copied).toContain("数学依然是你最专注的阵地");
      expect(copied).toContain("本周学习复盘");

      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: previousClipboard,
      });
    }
  });
});
