import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KnowledgePackEntry,
  KnowledgeTopic,
  TaskKnowledgePoint,
} from "../../types";
import { GraphPointPicker } from "../GraphPointPicker";
import { KnowledgePointList } from "../KnowledgePointDrawer";

const mockedInvoke = vi.mocked(invoke);

const PACKS: KnowledgePackEntry[] = [
  { subject: "math", name: "数学", count: 870, state: "builtin", builtin: true },
  { subject: "physics", name: "物理", count: 269, state: "builtin", builtin: true },
  { subject: "english", name: "英语", count: 791, state: "available", builtin: false },
];

const TOPICS: KnowledgeTopic[] = [
  {
    id: "cnm_001",
    name: "有理数",
    domain: "数与代数",
    grade: 7,
    stage: "初中",
    semester: "上",
    chapter: "七上 第一章",
    type: "conceptual",
    description: "正数、负数和 0",
    masteryCriteria: [],
    diagnosticQuestion: null,
    mathLinks: [],
  },
  {
    id: "cnm_002",
    name: "相反数",
    domain: "数与代数",
    grade: 7,
    stage: "初中",
    semester: "上",
    chapter: "七上 第一章",
    type: "procedural",
    description: "",
    masteryCriteria: [],
    diagnosticQuestion: null,
    mathLinks: [],
  },
];

function addedPoint(overrides: Partial<TaskKnowledgePoint> = {}): TaskKnowledgePoint {
  return {
    id: 21,
    task_id: 4,
    section_name: "数学",
    name: "有理数",
    is_mastered: 0,
    position: 0,
    graph_topic_id: "cnm_001",
    graph_subject: "math",
    ...overrides,
  };
}

function renderPicker(props: { taskSubject?: string | null; takenTopicIds?: string[] } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GraphPointPicker
        taskId={4}
        taskSubject={props.taskSubject === undefined ? "数学" : props.taskSubject}
        takenTopicIds={props.takenTopicIds ?? []}
      />
    </QueryClientProvider>,
  );
}

/** 某个命令的调用参数列表。 */
function callsOf(command: string) {
  return mockedInvoke.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => call[1] as Record<string, unknown>);
}

describe("GraphPointPicker", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_plugin_knowledge_packs") return PACKS;
      if (cmd === "list_plugin_knowledge_points") return TOPICS;
      if (cmd === "add_custom_knowledge_point") return addedPoint();
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("graph_point_picker_lands_on_the_subject_matching_the_task", async () => {
    renderPicker();

    expect(await screen.findByRole("button", { name: /有理数/ })).toBeInTheDocument();
    await waitFor(() => {
      const calls = callsOf("list_plugin_knowledge_points");
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]?.subject).toBe("math");
    });
  });

  it("graph_point_picker_only_offers_packs_that_are_ready_to_use", async () => {
    renderPicker();

    expect(await screen.findByRole("button", { name: /数学 870/ })).toBeInTheDocument();
    // 英语还没下载，里面没有数据，不该出现在选择器里。
    expect(screen.queryByRole("button", { name: /英语 791/ })).not.toBeInTheDocument();
    // 只给任务本学科的包：数学任务里不该出现物理的学科包。
    expect(screen.queryByRole("button", { name: /物理 269/ })).not.toBeInTheDocument();
  });

  it("graph_point_picker_matches_a_long_subject_name_to_its_pack", async () => {
    renderPicker({ taskSubject: "数学必修" });

    expect(await screen.findByRole("button", { name: /数学 870/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /物理 269/ })).not.toBeInTheDocument();
  });

  it("graph_point_picker_says_so_when_the_subject_pack_is_not_downloaded", async () => {
    renderPicker({ taskSubject: "英语" });

    expect(
      await screen.findByText("英语 的知识点包还没下载，先去工具箱下载后再挑考点。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /英语 791/ })).not.toBeInTheDocument();
  });

  it("graph_point_picker_asks_for_a_subject_when_the_task_has_none", async () => {
    renderPicker({ taskSubject: null });

    expect(
      await screen.findByText("这个任务没有科目，先给任务选个科目再挑考点。"),
    ).toBeInTheDocument();
  });

  it("graph_point_picker_adds_a_topic_with_the_upstream_id", async () => {
    renderPicker();

    fireEvent.click(await screen.findByRole("button", { name: "添加考点 有理数" }));

    await waitFor(() => {
      const calls = callsOf("add_custom_knowledge_point");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        taskId: 4,
        sectionName: "数学",
        name: "有理数",
        graphTopicId: "cnm_001",
        graphSubject: "math",
      });
    });
    expect(await screen.findByRole("status")).toHaveTextContent("已添加「有理数」");
  });

  it("graph_point_picker_marks_a_topic_that_is_already_added", async () => {
    renderPicker({ takenTopicIds: ["cnm_001"] });

    const button = await screen.findByRole("button", { name: "添加考点 有理数" });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("已添加");
    // 没加过的那个还能点。
    expect(screen.getByRole("button", { name: "添加考点 相反数" })).not.toBeDisabled();
  });

  it("graph_point_picker_reports_a_failed_add", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_plugin_knowledge_packs") return PACKS;
      if (cmd === "list_plugin_knowledge_points") return TOPICS;
      if (cmd === "add_custom_knowledge_point") {
        throw new Error("这个考点已经在列表里了");
      }
      return null;
    });

    renderPicker();

    fireEvent.click(await screen.findByRole("button", { name: "添加考点 有理数" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("这个考点已经在列表里了");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("graph_point_badge_marks_only_the_points_came_from_the_graph", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <KnowledgePointList
          taskId={4}
          points={[
            addedPoint({ id: 21, name: "有理数" }),
            {
              id: 22,
              task_id: 4,
              section_name: "第一章 有理数",
              name: "手写考点",
              is_mastered: 0,
              position: 1,
              graph_topic_id: null,
              graph_subject: null,
            },
          ]}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("图谱")).toBeInTheDocument();
    expect(screen.getAllByText("图谱")).toHaveLength(1);
    expect(screen.getByText("手写考点")).toBeInTheDocument();
  });
});
