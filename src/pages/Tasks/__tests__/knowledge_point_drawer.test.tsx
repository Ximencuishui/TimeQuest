import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KNOWLEDGE_POINT_DISCLAIMER } from "../../../lib/constants";
import { SECTION_EXISTS_MESSAGE } from "../../../lib/sectionCatalog";
import type { Task, TaskKnowledgePoint } from "../../../types";
import { Tasks } from "../../Tasks";

const mockedInvoke = vi.mocked(invoke);

function recordArgs(args?: InvokeArgs): Record<string, unknown> {
  if (!args || Array.isArray(args) || args instanceof ArrayBuffer || args instanceof Uint8Array) {
    return {};
  }
  return args;
}

const mainTask: Task = {
  id: 4,
  title: "数学必修一",
  type: "main",
  subject: "数学",
  textbook: "人教版 必修第一册",
  unit_name: "节",
  total_units: 15,
  total_rounds: 1,
  current_round: 1,
  color: "#F97316",
  archived: 0,
  created_at: "2026-11-07 10:00:00",
  actual_units_sum: 1,
};

const points: TaskKnowledgePoint[] = [
  {
    id: 8,
    task_id: 4,
    section_name: "1.2 集合间的基本关系",
    name: "空集",
    is_mastered: 0,
    position: 2,
  },
];

function renderTasks() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("knowledge point drawer", () => {
  afterEach(() => {
    cleanup();
  });

  it("task_list_opens_knowledge_drawer_and_toggle_sets_mastered", async () => {
    let mastered = 0;
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [mainTask];
      if (cmd === "get_task_knowledge_points") {
        return [{ ...points[0], is_mastered: mastered }];
      }
      if (cmd === "toggle_knowledge_point") {
        mastered = mastered === 1 ? 0 : 1;
        return { ...points[0], is_mastered: mastered };
      }
      return null;
    });

    renderTasks();

    fireEvent.click(await screen.findByRole("button", { name: "查看知识点 数学必修一" }));

    expect(await screen.findByRole("dialog", { name: "数学必修一 知识点" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "数学必修一" })).toBeInTheDocument();
    expect(screen.getByText(KNOWLEDGE_POINT_DISCLAIMER)).toHaveClass("text-xs", "text-zinc-500");
    const box = await screen.findByRole("checkbox", { name: "空集" });
    expect(box).not.toBeChecked();
    expect(screen.getByText("空集")).not.toHaveClass("line-through");

    fireEvent.click(box);
    await waitFor(() => {
      expect(screen.getByText("空集")).toHaveClass("text-green-400", "line-through");
    });
    expect(screen.getByRole("checkbox", { name: "空集" })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "空集" }));
    await waitFor(() => {
      expect(screen.getByText("空集")).not.toHaveClass("line-through");
    });
    expect(screen.getByRole("checkbox", { name: "空集" })).not.toBeChecked();
    const toggles = mockedInvoke.mock.calls.filter((call) => call[0] === "toggle_knowledge_point");
    expect(toggles).toEqual([
      ["toggle_knowledge_point", { id: 8 }],
      ["toggle_knowledge_point", { id: 8 }],
    ]);
  });

  it("knowledge_drawer_empty_offers_manual_add", async () => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [mainTask];
      if (cmd === "get_task_knowledge_points") return [];
      return null;
    });

    renderTasks();
    fireEvent.click(await screen.findByRole("button", { name: "查看知识点 数学必修一" }));

    expect(await screen.findByText("暂无考点，可点击上方按钮手动添加")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加节" })).toBeInTheDocument();
    expect(screen.getByText(KNOWLEDGE_POINT_DISCLAIMER)).toBeInTheDocument();
  });

  it("knowledge_drawer_adds_a_point_on_a_new_section_and_deletes_it", async () => {
    let rows: TaskKnowledgePoint[] = [];
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: InvokeArgs) => {
      const input = recordArgs(args);
      if (cmd === "list_tasks") return [mainTask];
      if (cmd === "get_task_knowledge_points") return rows;
      if (cmd === "add_custom_knowledge_point") {
        const row: TaskKnowledgePoint = {
          id: 21,
          task_id: Number(input.taskId),
          section_name: String(input.sectionName),
          name: String(input.name),
          is_mastered: 0,
          position: 0,
        };
        rows = [row];
        return row;
      }
      if (cmd === "delete_knowledge_point") {
        rows = rows.filter((row) => row.id !== Number(input.id));
        return null;
      }
      return null;
    });

    renderTasks();
    fireEvent.click(await screen.findByRole("button", { name: "查看知识点 数学必修一" }));
    expect(await screen.findByText("暂无考点，可点击上方按钮手动添加")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加节" }));
    const sectionInput = screen.getByRole("combobox", { name: "节名称" });
    fireEvent.change(sectionInput, { target: { value: "  自定义节  " } });
    fireEvent.submit(sectionInput.closest("form")!);

    expect(screen.getByText("自定义节")).toBeInTheDocument();
    expect(screen.queryByText("暂无考点，可点击上方按钮手动添加")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加考点 自定义节" }));
    const pointInput = screen.getByRole("textbox", { name: "新考点 自定义节" });
    fireEvent.change(pointInput, { target: { value: "韦达定理" } });
    fireEvent.submit(pointInput.closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "韦达定理" })).toBeInTheDocument();
    });
    expect(screen.getByRole("checkbox", { name: "韦达定理" })).not.toBeChecked();
    expect(mockedInvoke).toHaveBeenCalledWith("add_custom_knowledge_point", {
      taskId: 4,
      sectionName: "自定义节",
      name: "韦达定理",
    });

    fireEvent.click(screen.getByRole("button", { name: "删除 韦达定理" }));
    await waitFor(() => {
      expect(screen.getByText("暂无考点，可点击上方按钮手动添加")).toBeInTheDocument();
    });
    expect(mockedInvoke).toHaveBeenCalledWith("delete_knowledge_point", { id: 21 });
  });

  it("knowledge_drawer_selects_catalog_section_and_submits_custom_name", async () => {
    let rows: TaskKnowledgePoint[] = [...points];
    let nextId = 30;
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: InvokeArgs) => {
      const input = recordArgs(args);
      if (cmd === "list_tasks") return [mainTask];
      if (cmd === "get_task") return mainTask;
      if (cmd === "get_task_knowledge_points") return rows;
      if (cmd === "list_available_textbooks") {
        return [{ subject: "数学", version: "人教版", volume: "必修第一册" }];
      }
      if (cmd === "get_textbook_outline") {
        return {
          subject: "数学",
          version: "人教版",
          volume: "必修第一册",
          chapters: [
            {
              name: "第一章 集合与常用逻辑用语",
              sections: [
                { name: "1.1 集合的概念", knowledge_points: ["集合的含义"] },
                { name: "1.2 集合间的基本关系", knowledge_points: ["空集"] },
              ],
            },
          ],
        };
      }
      if (cmd === "add_custom_knowledge_point") {
        const row: TaskKnowledgePoint = {
          id: nextId,
          task_id: Number(input.taskId),
          section_name: String(input.sectionName),
          name: String(input.name),
          is_mastered: 0,
          position: 0,
        };
        nextId += 1;
        rows = [...rows, row];
        return row;
      }
      return null;
    });

    renderTasks();
    fireEvent.click(await screen.findByRole("button", { name: "查看知识点 数学必修一" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加节" }));

    const catalogSection = await screen.findByRole("option", { name: "1.1 集合的概念" });
    const takenSection = screen.getByRole("option", { name: /1\.2 集合间的基本关系/ });
    expect(takenSection).toBeDisabled();
    expect(takenSection).toHaveTextContent("已有");
    fireEvent.click(catalogSection);

    expect(screen.getByText("1.1 集合的概念")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加考点 1.1 集合的概念" }));
    const pointInput = screen.getByRole("textbox", { name: "新考点 1.1 集合的概念" });
    fireEvent.change(pointInput, { target: { value: "集合的含义" } });
    fireEvent.submit(pointInput.closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "集合的含义" })).toBeInTheDocument();
    });
    expect(mockedInvoke).toHaveBeenCalledWith("add_custom_knowledge_point", {
      taskId: 4,
      sectionName: "1.1 集合的概念",
      name: "集合的含义",
    });

    fireEvent.click(screen.getByRole("button", { name: "添加节" }));
    const sectionInput = screen.getByRole("combobox", { name: "节名称" });
    fireEvent.change(sectionInput, { target: { value: "1.2 集合间的基本关系" } });
    expect(await screen.findByText(SECTION_EXISTS_MESSAGE)).toBeInTheDocument();

    fireEvent.change(sectionInput, { target: { value: "  补充专题  " } });
    fireEvent.click(screen.getByRole("button", { name: "使用「补充专题」" }));
    expect(screen.getByText("补充专题")).toBeInTheDocument();
    expect(screen.queryByText(SECTION_EXISTS_MESSAGE)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加考点 补充专题" }));
    const customPoint = screen.getByRole("textbox", { name: "新考点 补充专题" });
    fireEvent.change(customPoint, { target: { value: "韦达定理" } });
    fireEvent.submit(customPoint.closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "韦达定理" })).toBeInTheDocument();
    });
    expect(mockedInvoke).toHaveBeenCalledWith("add_custom_knowledge_point", {
      taskId: 4,
      sectionName: "补充专题",
      name: "韦达定理",
    });
  });

  it("knowledge_drawer_lists_sections_when_textbook_is_renjiao_a", async () => {
    const demoTask: Task = { ...mainTask, textbook: "人教A版" };
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_tasks") return [demoTask];
      if (cmd === "get_task") return demoTask;
      if (cmd === "get_task_knowledge_points") return [];
      if (cmd === "list_available_textbooks") {
        return [
          { subject: "数学", version: "人教版", volume: "必修第一册" },
          { subject: "数学", version: "湘教版", volume: "必修第一册" },
          { subject: "数学", version: "人教版", volume: "必修第二册" },
        ];
      }
      if (cmd === "get_textbook_outline") {
        return {
          subject: "数学",
          version: "人教版",
          volume: "必修第一册",
          chapters: [
            {
              name: "第一章 集合与常用逻辑用语",
              sections: [{ name: "1.1 集合的概念", knowledge_points: ["集合的含义"] }],
            },
          ],
        };
      }
      return null;
    });

    renderTasks();
    fireEvent.click(await screen.findByRole("button", { name: "查看知识点 数学必修一" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加节" }));

    expect(await screen.findByRole("option", { name: "1.1 集合的概念" })).toBeInTheDocument();
    expect(mockedInvoke).toHaveBeenCalledWith("get_textbook_outline", {
      subject: "数学",
      version: "人教版",
      volume: "必修第一册",
    });
  });

  it("knowledge_drawer_picks_standard_point_and_disables_taken_tag", async () => {
    let rows: TaskKnowledgePoint[] = [
      {
        id: 8,
        task_id: 4,
        section_name: "1.1 集合的概念",
        name: "集合的含义",
        is_mastered: 0,
        position: 0,
      },
    ];
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: InvokeArgs) => {
      const input = recordArgs(args);
      if (cmd === "list_tasks") return [mainTask];
      if (cmd === "get_task") return mainTask;
      if (cmd === "get_task_knowledge_points") return rows;
      if (cmd === "list_available_textbooks") {
        return [{ subject: "数学", version: "人教版", volume: "必修第一册" }];
      }
      if (cmd === "get_textbook_outline") {
        return {
          subject: "数学",
          version: "人教版",
          volume: "必修第一册",
          chapters: [
            {
              name: "第一章 集合与常用逻辑用语",
              sections: [
                {
                  name: "1.1 集合的概念",
                  knowledge_points: ["集合的含义", "元素与集合的关系", "集合的表示方法"],
                },
              ],
            },
          ],
        };
      }
      if (cmd === "add_custom_knowledge_point") {
        const row: TaskKnowledgePoint = {
          id: 31,
          task_id: Number(input.taskId),
          section_name: String(input.sectionName),
          name: String(input.name),
          is_mastered: 0,
          position: 1,
        };
        rows = [...rows, row];
        return row;
      }
      return null;
    });

    renderTasks();
    fireEvent.click(await screen.findByRole("button", { name: "查看知识点 数学必修一" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加考点 1.1 集合的概念" }));

    const taken = await screen.findByRole("button", { name: "已添加 集合的含义" });
    expect(taken).toBeDisabled();
    expect(taken).toHaveTextContent("✓ 集合的含义");
    fireEvent.click(taken);
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      "add_custom_knowledge_point",
      expect.objectContaining({ name: "集合的含义" }),
    );

    expect(screen.getByRole("textbox", { name: "新考点 1.1 集合的概念" })).toHaveAttribute(
      "placeholder",
      "没找到？手动添加自定义考点...",
    );

    fireEvent.click(screen.getByRole("button", { name: "元素与集合的关系" }));
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("add_custom_knowledge_point", {
        taskId: 4,
        sectionName: "1.1 集合的概念",
        name: "元素与集合的关系",
      });
    });
    expect(await screen.findByRole("button", { name: "已添加 元素与集合的关系" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "元素与集合的关系" })).toBeInTheDocument();
  });
});
