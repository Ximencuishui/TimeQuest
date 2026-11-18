import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TextbookCatalog,
  TextbookDownloadProgress,
  TextbookOutline,
} from "../../types";
import { PluginTextbookLibrary } from "../PluginTextbookLibrary";

const mockedInvoke = vi.mocked(invoke);

const CATALOG: TextbookCatalog = {
  source: "https://github.com/TapXWorld/ChinaTextbook",
  repo: "TapXWorld/ChinaTextbook",
  rawBase: "https://raw.githubusercontent.com/TapXWorld/ChinaTextbook",
  commit: "abc123",
  generatedAt: "2026-11-18",
  count: 2,
  stages: [
    { label: "初中", count: 1 },
    { label: "高中", count: 1 },
  ],
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
    {
      path: "高中/物理/人教版/普通高中教科书·物理选择性必修第一册.pdf",
      title: "普通高中教科书·物理选择性必修第一册",
      stage: "高中",
      stageKey: "高中",
      subject: "物理",
      edition: "人教版",
      grade: null,
      size: 5_000_000,
      parts: 2,
      shards: [
        { index: 1, size: 2_500_000, sha: "sha-two" },
        { index: 2, size: 2_500_000, sha: "sha-three" },
      ],
    },
  ],
};

const OUTLINE: TextbookOutline = {
  subject: "数学",
  version: "人教版-人民教育出版社",
  volume: "义务教育教科书·数学七年级上册",
  chapters: [
    {
      name: "第一章 有理数",
      sections: [
        { name: "1.1 正数和负数", knowledge_points: [] },
        { name: "1.2 相反数", knowledge_points: [] },
      ],
    },
    {
      name: "第二章 整式的加减",
      sections: [{ name: "2.1 整式", knowledge_points: [] }],
    },
  ],
};

function renderLibrary() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PluginTextbookLibrary pluginId="china-textbook" />
    </QueryClientProvider>,
  );
}

describe("PluginTextbookLibrary", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(listen).mockReset();
    vi.mocked(listen).mockImplementation(async () => () => undefined);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_plugin_textbook_catalog") return CATALOG;
      if (cmd === "download_plugin_textbook") {
        return { file: "C:/books/math-7.pdf", bytes: 10_453_040 };
      }
      if (cmd === "import_textbook_pdf") {
        return { outline: OUTLINE, replaced: false };
      }
      if (cmd === "list_available_textbooks") return [];
      if (cmd === "generate_tasks_from_outline") {
        return {
          task_id: 7,
          total_units: 3,
          planned_count: 2,
          done_count: 1,
          last_planned_date: "2026-11-20",
        };
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("lists_the_catalog_books_with_stage_and_subject_filters", async () => {
    renderLibrary();

    expect(
      await screen.findByText("义务教育教科书·数学七年级上册"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("普通高中教科书·物理选择性必修第一册"),
    ).toBeInTheDocument();

    // 按学段筛：只看高中。
    fireEvent.click(screen.getByRole("tab", { name: "高中 1" }));

    expect(
      screen.getByText("普通高中教科书·物理选择性必修第一册"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("义务教育教科书·数学七年级上册"),
    ).not.toBeInTheDocument();

    // 按科目筛：回到全部学段后只留数学。
    fireEvent.click(screen.getByRole("tab", { name: "全部" }));
    fireEvent.change(screen.getByLabelText("科目"), {
      target: { value: "数学" },
    });

    expect(
      screen.getByText("义务教育教科书·数学七年级上册"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("普通高中教科书·物理选择性必修第一册"),
    ).not.toBeInTheDocument();
  });

  it("searches_the_catalog_by_title", async () => {
    renderLibrary();

    fireEvent.change(await screen.findByLabelText("搜索教材"), {
      target: { value: "物理" },
    });

    expect(
      screen.getByText("普通高中教科书·物理选择性必修第一册"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("义务教育教科书·数学七年级上册"),
    ).not.toBeInTheDocument();
  });

  it("downloads_a_book_and_parses_its_outline", async () => {
    renderLibrary();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "下载 义务教育教科书·数学七年级上册",
      }),
    );

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "download_plugin_textbook",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({
        pluginId: "china-textbook",
        path: "初中/数学/人教版/义务教育教科书·数学七年级上册.pdf",
      });
    });

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "import_textbook_pdf",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({
        file: "C:/books/math-7.pdf",
        subject: "数学",
        version: "人教版-人民教育出版社",
        volume: "义务教育教科书·数学七年级上册",
      });
    });

    expect(await screen.findByText("已导入 2 章")).toBeInTheDocument();
  });

  it("reports_a_failed_download_without_pretending_it_worked", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_plugin_textbook_catalog") return CATALOG;
      if (cmd === "download_plugin_textbook") throw new Error("下载失败：服务器返回 500");
      return null;
    });

    renderLibrary();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "下载 义务教育教科书·数学七年级上册",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "下载失败：服务器返回 500",
    );
    expect(screen.queryByText(/已导入/)).not.toBeInTheDocument();
  });

  it("shows_the_retry_attempt_when_the_download_resumes", async () => {
    const handlers: Array<(event: { payload: TextbookDownloadProgress }) => void> = [];
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(listen).mockImplementation(async (_event, handler) => {
      handlers.push(handler as never);
      return () => undefined;
    });
    // 下载一直挂着，进度条才有得显示。
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_plugin_textbook_catalog") return CATALOG;
      if (cmd === "download_plugin_textbook") return new Promise(() => {});
      return null;
    });

    renderLibrary();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "下载 义务教育教科书·数学七年级上册",
      }),
    );

    await waitFor(() => expect(handlers.length).toBeGreaterThan(0));
    handlers[0]({
      payload: {
        path: CATALOG.textbooks[0].path,
        downloaded: 5_000_000,
        total: 10_453_040,
        part: 1,
        parts: 1,
        attempt: 2,
      },
    });

    expect(await screen.findByText(/重试第 2 次/)).toBeInTheDocument();
  });

  it("turns_the_parsed_outline_into_a_task_through_the_import_wizard", async () => {
    renderLibrary();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "下载 义务教育教科书·数学七年级上册",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "勾选已掌握 义务教育教科书·数学七年级上册",
      }),
    );

    // 向导直接从「勾选已掌握」开始，不让用户再选一次书。
    expect(await screen.findByText("第一章 有理数")).toBeInTheDocument();
    expect(screen.queryByText("选择教材")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("1.1 正数和负数"));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    fireEvent.click(await screen.findByRole("button", { name: "确认生成" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "generate_tasks_from_outline",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toMatchObject({
        subject: "数学",
        version: "人教版-人民教育出版社",
        volume: "义务教育教科书·数学七年级上册",
        taskName: "数学 · 七年级",
        selectedSections: ["1.1 正数和负数"],
        autoSchedule: true,
      });
    });

    expect(await screen.findByText(/任务创建成功/)).toBeInTheDocument();
  });
});
