import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<p>看板内容</p>} />
            <Route path="mistakes" element={<p>错题本内容</p>} />
            <Route path="toolbox" element={<p>工具箱内容</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Layout toolbox navigation", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_user_profile") {
        return {
          avatar: null,
          grade: "高二",
          region: "北京",
          total_target: 0,
        };
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("layout_places_the_toolbox_in_the_main_navigation", () => {
    const { container } = renderLayout();

    const sidebar = container.querySelector("aside") as HTMLElement;
    expect(within(sidebar).getByRole("link", { name: "工具箱" })).toHaveAttribute(
      "href",
      "/toolbox",
    );
    // 工具箱是独立的一页，不是需要点开的折叠分组。
    expect(
      container.querySelector('[data-testid="toolbox-nav-toggle"]'),
    ).not.toBeInTheDocument();
  });

  it("layout_hides_the_mistake_book_from_the_main_navigation", () => {
    const { container } = renderLayout("/mistakes");

    const sidebar = container.querySelector("aside") as HTMLElement;
    expect(
      within(sidebar).queryByRole("link", { name: "错题本" }),
    ).not.toBeInTheDocument();
    // 错题本自己的页面还在，只是入口挪进了工具箱。
    expect(screen.getByText("错题本内容")).toBeInTheDocument();
  });

  it("layout_keeps_a_toolbox_entry_in_the_bottom_bar", () => {
    renderLayout();

    const bottomLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/toolbox");
    expect(bottomLinks.length).toBeGreaterThan(0);
  });
});