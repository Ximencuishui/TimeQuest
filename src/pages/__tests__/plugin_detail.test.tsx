import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginInfo, PluginOptionValue, TextbookCatalog } from "../../types";
import { PluginDetail } from "../PluginDetail";

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
    options: [
      {
        key: "focus_minutes",
        label: "专注时长（分钟）",
        kind: "number",
        default: "25",
      },
    ],
    installed: false,
    ...partial,
  };
}

/** 教材源插件：自带一份教材清单，技术选项收在高级设置里。 */
function makeTextbookPlugin(): PluginInfo {
  return makePlugin({
    id: "china-textbook",
    name: "中小学教材库",
    summary: "按需下载单本 PDF。",
    author: "TapXWorld",
    icon: "📚",
    capabilities: ["教材库：1920 本中小学教材"],
    options: [
      {
        key: "download_source",
        label: "下载通道",
        kind: "select",
        default: "blob",
        choices: ["blob", "raw"],
        choice_labels: {
          blob: "标准通道（推荐）",
          raw: "备用通道（标准通道失败时再试）",
        },
        help: "教材 PDF 存在 GitHub 上。默认用「标准通道」就行。",
        advanced: true,
      },
      {
        key: "github_token",
        label: "GitHub 访问令牌（选填）",
        kind: "text",
        default: "",
        help: "平时不用填。",
        advanced: true,
        secret: true,
      },
    ],
    resources: [
      {
        path: "catalog.json",
        kind: "textbook_catalog",
        description: "教材清单快照",
      },
    ],
    installed: true,
  });
}

const CATALOG: TextbookCatalog = {
  source: "https://github.com/TapXWorld/ChinaTextbook",
  repo: "TapXWorld/ChinaTextbook",
  rawBase: "https://raw.githubusercontent.com/TapXWorld/ChinaTextbook",
  commit: "abc123",
  generatedAt: "2026-11-18",
  count: 1,
  stages: [{ label: "初中", count: 1 }],
  textbooks: [
    {
      path: "初中/数学/人教版/义务教育教科书·数学七年级上册.pdf",
      title: "义务教育教科书·数学七年级上册",
      stage: "初中",
      stageKey: "初中",
      subject: "数学",
      edition: "人教版-人民教育出版社",
      grade: "七年级",
      size: 10_453_040,
      parts: 1,
      shards: [{ index: 1, size: 10_453_040, sha: "sha-one" }],
    },
  ],
};

function renderDetail(pluginId = "focus-25") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/toolbox/plugins/${pluginId}`]}>
        <Routes>
          <Route path="/toolbox/plugins/:pluginId" element={<PluginDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PluginDetail page", () => {
  let plugins: PluginInfo[];
  let optionValues: PluginOptionValue[];

  beforeEach(() => {
    plugins = [makePlugin({ id: "focus-25" })];
    optionValues = [
      {
        key: "focus_minutes",
        label: "专注时长（分钟）",
        kind: "number",
        value: "25",
      },
    ];
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "list_plugins") return plugins;
      if (cmd === "list_plugin_options") return optionValues;
      if (cmd === "list_plugin_textbook_catalog") return CATALOG;
      if (cmd === "install_plugin") {
        const a = args as { id: string };
        plugins = plugins.map((plugin) =>
          plugin.id === a.id ? { ...plugin, installed: true } : plugin,
        );
        return plugins.find((plugin) => plugin.id === a.id) ?? null;
      }
      if (cmd === "uninstall_plugin") {
        const a = args as { id: string };
        plugins = plugins.map((plugin) =>
          plugin.id === a.id ? { ...plugin, installed: false } : plugin,
        );
        return null;
      }
      if (cmd === "set_plugin_option") {
        const a = args as { pluginId: string; key: string; value: string };
        optionValues = optionValues.map((option) =>
          option.key === a.key ? { ...option, value: a.value } : option,
        );
        return null;
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("plugin_detail_shows_the_plugin_manifest", async () => {
    renderDetail();

    expect(
      await screen.findByRole("heading", { name: "深度专注 25 分钟" }),
    ).toBeInTheDocument();
    expect(screen.getByText("TimeQuest 官方 · v1.0.0 · 1 KB")).toBeInTheDocument();
    expect(
      screen.getByText("专注模式：25 分钟专注 + 5 分钟休息循环"),
    ).toBeInTheDocument();
  });

  it("plugin_detail_downloads_and_installs_the_plugin", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "下载并安装" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "install_plugin",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({ id: "focus-25" });
    });

    expect(await screen.findByText("已安装")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "卸载" }),
    ).toBeInTheDocument();
  });

  it("plugin_detail_shows_options_after_install", async () => {
    renderDetail();

    expect(
      await screen.findByRole("button", { name: "下载并安装" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("专注时长（分钟）")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下载并安装" }));

    const input = await screen.findByLabelText("专注时长（分钟）");
    expect(input).toHaveValue(25);

    fireEvent.change(input, { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "set_plugin_option",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({
        pluginId: "focus-25",
        key: "focus_minutes",
        value: "45",
      });
    });
  });

  it("plugin_detail_uninstalls_the_plugin", async () => {
    plugins = [makePlugin({ id: "focus-25", installed: true })];
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "卸载" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "uninstall_plugin",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({ id: "focus-25" });
    });
  });

  it("plugin_detail_shows_not_found_for_an_unknown_plugin", async () => {
    renderDetail("not-in-catalog");

    expect(
      await screen.findByRole("heading", { name: "插件不存在" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下载并安装" })).not.toBeInTheDocument();
  });

  it("plugin_detail_shows_the_textbook_library_for_a_textbook_source", async () => {
    plugins = [makeTextbookPlugin()];
    renderDetail("china-textbook");

    expect(
      await screen.findByRole("heading", { name: "教材库" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("义务教育教科书·数学七年级上册"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "下载 义务教育教科书·数学七年级上册",
      }),
    ).toBeInTheDocument();
  });

  it("plugin_detail_hides_the_textbook_library_for_other_plugins", async () => {
    plugins = [makePlugin({ id: "focus-25", installed: true })];
    renderDetail("focus-25");

    expect(
      await screen.findByRole("heading", { name: "深度专注 25 分钟" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "教材库" })).not.toBeInTheDocument();
  });

  it("plugin_detail_saves_a_select_option_right_away", async () => {
    plugins = [makeTextbookPlugin()];
    renderDetail("china-textbook");

    const select = await screen.findByLabelText("下载通道");
    expect(select).toHaveValue("blob");

    fireEvent.change(select, { target: { value: "raw" } });

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "set_plugin_option",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({
        pluginId: "china-textbook",
        key: "download_source",
        value: "raw",
      });
    });
  });

  it("plugin_detail_folds_advanced_options_away_by_default", async () => {
    plugins = [makeTextbookPlugin()];
    renderDetail("china-textbook");

    const summary = await screen.findByText("高级设置（一般不用改）");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(
      screen.queryByRole("heading", { name: "设置" }),
      "全是高级选项时不该再摆一个空的「设置」标题",
    ).not.toBeInTheDocument();
  });

  it("plugin_detail_shows_friendly_choice_names_instead_of_raw_values", async () => {
    plugins = [makeTextbookPlugin()];
    renderDetail("china-textbook");

    const select = (await screen.findByLabelText("下载通道")) as HTMLSelectElement;
    const labels = Array.from(select.options).map((option) => option.textContent);
    expect(labels).toEqual(["标准通道（推荐）", "备用通道（标准通道失败时再试）"]);
    expect(labels).not.toContain("blob");
    expect(labels).not.toContain("raw");
  });

  it("plugin_detail_masks_the_token_field_and_explains_it", async () => {
    plugins = [makeTextbookPlugin()];
    renderDetail("china-textbook");

    const token = await screen.findByLabelText("GitHub 访问令牌（选填）");
    expect(token).toHaveAttribute("type", "password");
    expect(screen.getByText("平时不用填。")).toBeInTheDocument();
  });

  it("plugin_detail_keeps_normal_options_flat_without_an_advanced_section", async () => {
    plugins = [makePlugin({ id: "focus-25", installed: true })];
    renderDetail("focus-25");

    expect(await screen.findByLabelText("专注时长（分钟）")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(
      screen.queryByText("高级设置（一般不用改）"),
      "没有高级选项时不该多一个折叠区",
    ).not.toBeInTheDocument();
  });
});