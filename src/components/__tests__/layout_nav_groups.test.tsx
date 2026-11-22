import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen, within } from "@testing-library/react";
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

  it("layout_groups_navigation_into_plan_review_and_tools", () => {
    renderLayout();

    expect(screen.getByTestId("nav-group-plan")).toHaveTextContent("计划");
    expect(screen.getByTestId("nav-group-review")).toHaveTextContent("复盘");
    expect(screen.getByTestId("nav-group-tools")).toHaveTextContent("工具");
    // 设置不再占导航分组，入口改成底部头像。
    expect(screen.queryByTestId("nav-group-settings")).not.toBeInTheDocument();
  });

  it("layout_renames_and_reorders_the_navigation_entries", () => {
    const { container } = renderLayout();
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();

    // 只统计导航区：侧边栏底部的头像是链接，但它是设置入口，不算导航项。
    const links = Array.from(aside?.querySelectorAll("nav a") ?? []);
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "总计划",
      "今日任务",
      "统计",
      "成绩",
      "看板",
      "便签",
      "工具箱",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/tasks",
      "/today",
      "/stats",
      "/scores",
      "/",
      "/notes",
      "/toolbox",
    ]);
    // 旧文案不再出现。
    expect(screen.queryByText("任务")).not.toBeInTheDocument();
  });

  it("layout_marks_the_current_page_in_the_navigation", () => {
    const { container } = renderLayout("/tasks");
    const aside = container.querySelector("aside");
    const links = Array.from(aside?.querySelectorAll("nav a") ?? []);

    const active = links.filter((link) =>
      link.className.includes("bg-accent/15"),
    );
    expect(active).toHaveLength(1);
    expect(active[0].textContent?.trim()).toBe("总计划");
  });

  it("layout_opens_settings_from_the_profile_avatar", () => {
    const { container } = renderLayout();
    const aside = container.querySelector("aside") as HTMLElement;
    const chip = within(aside).getByTestId("profile-chip");

    // 设置页的唯一入口是侧边栏底部的头像。
    expect(chip).toHaveAttribute("href", "/settings");
    expect(
      within(aside).queryByRole("link", { name: "设置" }),
    ).not.toBeInTheDocument();

    // 窄屏底栏也不再放设置，只剩头像这一条路（桌面侧边栏 + 窄屏顶栏各一个）。
    expect(screen.queryAllByRole("link", { name: "设置" })).toHaveLength(0);
    expect(
      screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("href") === "/settings"),
    ).toHaveLength(2);
  });
});
