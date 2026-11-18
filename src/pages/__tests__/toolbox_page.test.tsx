import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginInfo } from "../../types";
import { Toolbox } from "../Toolbox";

const mockedInvoke = vi.mocked(invoke);

function makePlugin(partial: Partial<PluginInfo> & { id: string }): PluginInfo {
  return {
    name: "深度专注 25 分钟",
    summary: "给专注模式加一套 25/5 循环。",
    author: "TimeQuest 官方",
    version: "1.0.0",
    icon: "⏱",
    size_kb: 1,
    capabilities: ["专注模式：25 分钟专注 + 5 分钟休息循环"],
    options: [],
    installed: false,
    ...partial,
  };
}

function renderToolbox() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/toolbox"]}>
        <Routes>
          <Route path="/toolbox" element={<Toolbox />} />
          <Route path="/mistakes" element={<h1>错题本页面</h1>} />
          <Route
            path="/toolbox/plugins/:pluginId"
            element={<h1>插件详情页面</h1>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Toolbox page", () => {
  let plugins: PluginInfo[];

  beforeEach(() => {
    plugins = [makePlugin({ id: "focus-25" })];
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_plugins") return plugins;
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("toolbox_shows_the_tools_as_an_icon_grid", async () => {
    renderToolbox();

    expect(
      await screen.findByRole("heading", { name: "工具箱" }),
    ).toBeInTheDocument();

    // 内置工具和插件都只以图标格子的形式出现，不直接铺开设置项。
    const mistakeTile = screen.getByTestId("tool-tile-mistakes");
    expect(mistakeTile).toBeInTheDocument();
    expect(mistakeTile.textContent).toContain("错题本");

    const pluginTile = await screen.findByTestId("plugin-tile-focus-25");
    expect(pluginTile).toBeInTheDocument();
    expect(pluginTile.textContent).toContain("深度专注 25 分钟");
    expect(screen.queryByLabelText("专注时长（分钟）")).not.toBeInTheDocument();
  });

  it("toolbox_opens_the_mistake_book_when_the_icon_is_clicked", async () => {
    renderToolbox();

    fireEvent.click(await screen.findByTestId("tool-tile-mistakes"));

    expect(
      await screen.findByRole("heading", { name: "错题本页面" }),
    ).toBeInTheDocument();
  });

  it("toolbox_opens_the_plugin_page_when_the_plugin_icon_is_clicked", async () => {
    renderToolbox();

    fireEvent.click(await screen.findByTestId("plugin-tile-focus-25"));

    expect(
      await screen.findByRole("heading", { name: "插件详情页面" }),
    ).toBeInTheDocument();
  });

  it("toolbox_marks_plugins_that_are_not_installed", async () => {
    renderToolbox();

    const tile = await screen.findByTestId("plugin-tile-focus-25");
    expect(tile.textContent).toContain("未安装");
  });

  it("toolbox_hides_the_badge_for_installed_plugins", async () => {
    plugins = [makePlugin({ id: "focus-25", installed: true })];
    renderToolbox();

    const tile = await screen.findByTestId("plugin-tile-focus-25");
    expect(tile.textContent).not.toContain("未安装");
  });
});