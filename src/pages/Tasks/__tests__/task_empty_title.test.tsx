import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tasks } from "../../Tasks";

const mockedInvoke = vi.mocked(invoke);

function createTaskCalls(): number {
  return mockedInvoke.mock.calls.filter((call) => call[0] === "create_task").length;
}

function renderTasks() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Tasks empty title guard", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("task_empty_title_shows_error_and_does_not_create", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "新建任务" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));

    const titleInput = screen.getByLabelText("标题") as HTMLInputElement;
    // 只输入空格：等价于什么都没写。
    fireEvent.change(titleInput, { target: { value: "   " } });

    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请给任务起个名字");
    expect(titleInput).toHaveAttribute("aria-invalid", "true");
    expect(createTaskCalls()).toBe(0);

    // 补上名字后错误消失，可以正常创建。
    fireEvent.change(titleInput, { target: { value: "物理必修二 第一轮" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => {
      expect(createTaskCalls()).toBe(1);
    });
  });
});
