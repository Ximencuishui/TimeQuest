import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Layout } from "../Layout";

const mockedInvoke = vi.mocked(invoke);

function renderLayout(path = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Layout />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("侧边栏分组导航", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async () => null);
  });

  afterEach(() => {
    cleanup();
  });

  it("layout_groups_navigation_into_plan_review_tools_and_settings", () => {
    renderLayout();

    expect(screen.getByTestId("nav-group-plan")).toHaveTextContent("计划");
    expect(screen.getByTestId("nav-group-review")).toHaveTextContent("复盘");
    expect(screen.getByTestId("nav-group-tools")).toHaveTextContent("工具");
    expect(screen.getByTestId("nav-group-settings")).toHaveTextContent("设置");
  });

  it("layout_renames_and_reorders_the_navigation_entries", () => {
    const { container } = renderLayout();
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();

    const links = Array.from(aside?.querySelectorAll("a") ?? []);
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "总计划",
      "今日任务",
      "统计",
      "成绩",
      "看板",
      "便签",
      "工具箱",
      "设置",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/tasks",
      "/today",
      "/stats",
      "/scores",
      "/",
      "/notes",
      "/toolbox",
      "/settings",
    ]);
    // 旧文案不再出现。
    expect(screen.queryByText("任务")).not.toBeInTheDocument();
  });

  it("layout_marks_the_current_page_in_the_navigation", () => {
    const { container } = renderLayout("/tasks");
    const aside = container.querySelector("aside");
    const links = Array.from(aside?.querySelectorAll("a") ?? []);

    const active = links.filter((link) =>
      link.className.includes("bg-accent/15"),
    );
    expect(active).toHaveLength(1);
    expect(active[0].textContent?.trim()).toBe("总计划");
  });
});
