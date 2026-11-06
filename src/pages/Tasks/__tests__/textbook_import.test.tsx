import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTBOOK_CATALOG } from "../../../lib/textbooks";
import { useUiStore } from "../../../store/ui";
import type { TextbookOutline } from "../../../types";
import { Tasks } from "../../Tasks";

const mockedInvoke = vi.mocked(invoke);
const book = TEXTBOOK_CATALOG[0]!;
const catalog = [
  { subject: "生物", version: "人教版", volume: "必修1 分子与细胞" },
  { subject: "英语", version: "人教版", volume: "必修第一册" },
  book,
  { subject: "数学", version: "人教版", volume: "必修第二册" },
  { subject: "物理", version: "人教版", volume: "必修第一册" },
  { subject: "化学", version: "人教版", volume: "必修第一册" },
  { subject: "语文", version: "统编版", volume: "必修上册" },
];

const outline: TextbookOutline = {
  subject: book.subject,
  version: book.version,
  volume: book.volume,
  chapters: [
    {
      name: "第一章 集合与常用逻辑用语",
      sections: ["1.1 集合的概念", "1.2 集合间的基本关系", "1.3 集合的基本运算"],
    },
    {
      name: "第二章 一元二次函数、方程和不等式",
      sections: ["2.1 等式性质与不等式性质", "2.2 基本不等式", "2.3 二次函数与一元二次方程、不等式"],
    },
  ],
};

function listTaskCalls(): number {
  return mockedInvoke.mock.calls.filter((call) => call[0] === "list_tasks").length;
}

function renderTasks() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openBookStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "从教材导入" }));
  expect(await screen.findByRole("button", { name: "物理 人教版 必修第一册" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "化学 人教版 必修第一册" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "语文 统编版 必修上册" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "数学 人教版 必修第二册" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "英语 人教版 必修第一册" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "生物 人教版 必修1 分子与细胞" })).toBeInTheDocument();
  const headings = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
  expect(headings).toEqual(["数学", "语文", "英语", "物理", "化学", "生物"]);
  expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
}

async function openConfirmStep(user: ReturnType<typeof userEvent.setup>) {
  await openBookStep(user);
  const math = screen.getByRole("button", { name: "数学 人教版 必修第一册" });
  await user.click(math);
  expect(math).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "下一步" }));
  expect(
    await screen.findByText(
      "勾选你已掌握的节，将直接标记为完成（不增加经验值），为你生成剩下的学习任务。",
    ),
  ).toBeInTheDocument();
}

describe("textbook import wizard", () => {
  beforeEach(() => {
    useUiStore.setState({ taskView: "list" });
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [];
      if (cmd === "list_available_textbooks") return catalog;
      if (cmd === "get_textbook_outline") return outline;
      if (cmd === "generate_tasks_from_outline") {
        return { taskId: 7, totalUnits: 6, plannedCount: 4, doneCount: 2 };
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    useUiStore.setState({ taskView: "list" });
  });

  it("textbook_import_checked_sections_preview_stats_and_generate", async () => {
    const user = userEvent.setup();
    renderTasks();

    await waitFor(() => {
      expect(listTaskCalls()).toBeGreaterThan(0);
    });

    await openConfirmStep(user);
    const outlineCall = mockedInvoke.mock.calls.find((call) => call[0] === "get_textbook_outline");
    expect(outlineCall?.[1]).toEqual({
      subject: book.subject,
      version: book.version,
      volume: book.volume,
    });

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(6);
    for (const box of boxes) expect(box).not.toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "2.2 基本不等式" }));
    await user.click(screen.getByRole("checkbox", { name: "1.1 集合的概念" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByText("共 6 节，已掌握 2 节，将生成 4 个待办排期。")).toBeInTheDocument();
    expect(screen.getByLabelText("任务名称")).toHaveValue("数学必修一");

    const beforeRefresh = listTaskCalls();
    await user.click(screen.getByRole("button", { name: "确认生成" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent("任务创建成功，已生成 4 个排期。");

    const generateCalls = mockedInvoke.mock.calls.filter(
      (call) => call[0] === "generate_tasks_from_outline",
    );
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]?.[1]).toEqual({
      subject: outline.subject,
      version: outline.version,
      volume: outline.volume,
      taskName: "数学必修一",
      selectedSections: ["1.1 集合的概念", "2.2 基本不等式"],
      autoSchedule: true,
    });
    await waitFor(() => {
      expect(listTaskCalls()).toBeGreaterThan(beforeRefresh);
    });

    await user.click(screen.getByRole("button", { name: "从教材导入" }));
    const math = await screen.findByRole("button", { name: "数学 人教版 必修第一册" });
    expect(math).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("textbook_import_task_only_sends_auto_schedule_false", async () => {
    const user = userEvent.setup();
    renderTasks();
    await openConfirmStep(user);
    await user.click(screen.getByRole("checkbox", { name: "1.1 集合的概念" }));
    await user.click(screen.getByRole("checkbox", { name: "2.2 基本不等式" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("radio", { name: "仅创建主线任务，不自动生成排期" }));

    expect(
      screen.getByText("共 6 节，已掌握 2 节。只创建主线任务，不生成排期。"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认生成" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent("任务创建成功。");
    const generateCalls = mockedInvoke.mock.calls.filter(
      (call) => call[0] === "generate_tasks_from_outline",
    );
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]?.[1]).toEqual({
      subject: outline.subject,
      version: outline.version,
      volume: outline.volume,
      taskName: "数学必修一",
      selectedSections: ["1.1 集合的概念", "2.2 基本不等式"],
      autoSchedule: false,
    });
  });

  it("textbook_import_disables_generate_when_task_name_empty", async () => {
    const user = userEvent.setup();
    renderTasks();
    await openConfirmStep(user);
    await user.click(screen.getByRole("button", { name: "下一步" }));

    const name = screen.getByLabelText("任务名称");
    await user.clear(name);
    expect(name).toHaveValue("");
    expect(screen.getByText("请填写任务名称")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认生成" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "确认生成" }));
    expect(mockedInvoke.mock.calls.some((call) => call[0] === "generate_tasks_from_outline")).toBe(
      false,
    );
  });
});
