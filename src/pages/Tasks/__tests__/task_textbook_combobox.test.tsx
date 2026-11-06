import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../../../store/ui";
import { Tasks } from "../../Tasks";

const mockedInvoke = vi.mocked(invoke);

const catalog = [
  { subject: "数学", version: "人教版", volume: "必修第一册" },
  { subject: "英语", version: "人教版", volume: "必修第一册" },
  { subject: "语文", version: "统编版", volume: "必修上册" },
];

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

describe("new task textbook combobox", () => {
  beforeEach(() => {
    useUiStore.setState({ taskView: "list" });
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [];
      if (cmd === "list_available_textbooks") return catalog;
      if (cmd === "get_textbook_outline") {
        return {
          subject: "语文",
          version: "统编版",
          volume: "必修上册",
          chapters: [
            { name: "第一单元", sections: ["1 沁园春·长沙", "2 立在地球边上放号", "3 红烛"] },
            { name: "第二单元", sections: ["4 喜看稻菽千重浪"] },
          ],
        };
      }
      if (cmd === "create_task") return { id: 3 };
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    useUiStore.setState({ taskView: "list" });
  });

  it("task_textbook_field_accepts_custom_text_and_picks_a_builtin_volume", async () => {
    const user = userEvent.setup();
    renderTasks();
    await user.click(screen.getByRole("button", { name: "新建任务" }));

    const book = await screen.findByRole("combobox", { name: "课本" });
    expect(book).toBeEnabled();
    expect(book.className).toContain("outline-none");
    expect(book.className).toContain("focus:ring-orange-500");

    await user.type(book, "新概念英语2");
    expect(book).toHaveValue("新概念英语2");
    expect(screen.getByText("没有匹配的课本，可直接使用输入的名称")).toBeInTheDocument();
    expect(screen.getByLabelText("科目")).toHaveValue("数学");

    await user.clear(book);
    await user.click(book);
    expect(await screen.findByRole("option", { name: /数学 · 人教版/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /必修上册/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /英语 · 人教版/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("总课数")).toHaveValue(40);

    await user.selectOptions(screen.getByLabelText("科目"), "语文");
    expect(book).toHaveValue("");
    expect(await screen.findByRole("option", { name: /必修上册/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /数学 · 人教版/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /必修上册/ }));
    expect(book).toHaveValue("必修上册");
    expect(screen.getByLabelText("科目")).toHaveValue("语文");
    await waitFor(() => expect(screen.getByLabelText("总课数")).toHaveValue(4));

    await user.type(screen.getByLabelText("标题"), "语文上册");
    await user.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "create_task",
        expect.objectContaining({
          payload: expect.objectContaining({
            title: "语文上册",
            subject: "语文",
            textbook: "必修上册",
            total_units: 4,
          }),
        }),
      );
    });
  });
});
