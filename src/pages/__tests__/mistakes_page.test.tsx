import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgePackEntry, KnowledgeTopic, Mistake } from "../../types";
import { Mistakes } from "../Mistakes";

const mockedInvoke = vi.mocked(invoke);

const GRAPH_PLUGIN_ID = "cn-knowledge-graph";

const PACKS: KnowledgePackEntry[] = [
  { subject: "math", name: "数学", count: 870, state: "builtin", builtin: true },
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
];

function makeMistake(partial: Partial<Mistake> & { id: number }): Mistake {
  return {
    subject: "物理",
    title: "牛顿第二定律应用",
    reason: "概念不清",
    correct_note: "",
    is_mastered: 0,
    graph_topic_id: null,
    graph_subject: null,
    graph_topic_name: null,
    created_at: "2026-11-18 10:00:00",
    updated_at: "2026-11-18 10:00:00",
    ...partial,
  };
}

/** 把当前路由写出来，用来验跳转。 */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderMistakes(initialEntries: string[] = ["/mistakes"]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <Mistakes />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Mistakes page", () => {
  let rows: Mistake[];
  let nextId: number;
  /** 知识图谱插件装了没有。没装的时候错题上的知识点只是一个标签，不是链接。 */
  let graphInstalled: boolean;

  beforeEach(() => {
    rows = [];
    nextId = 1;
    graphInstalled = false;
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "list_mistakes") return rows;
      if (cmd === "list_plugins") {
        if (!graphInstalled) return [];
        return [
          {
            id: GRAPH_PLUGIN_ID,
            name: "知识图谱",
            summary: "",
            author: "",
            version: "",
            icon: "",
            size_kb: 0,
            capabilities: [],
            options: [],
            installed: true,
          },
        ];
      }
      if (cmd === "list_plugin_knowledge_packs") return PACKS;
      if (cmd === "list_plugin_knowledge_points") return TOPICS;
      if (cmd === "create_mistake") {
        const a = (
          args as {
            payload: {
              subject: string;
              title: string;
              reason: string;
              correctNote: string;
              graphTopicId?: string | null;
              graphSubject?: string | null;
              graphTopicName?: string | null;
            };
          }
        ).payload;
        const row = makeMistake({
          id: nextId++,
          subject: a.subject,
          title: a.title,
          reason: a.reason,
          correct_note: a.correctNote,
          graph_topic_id: a.graphTopicId ?? null,
          graph_subject: a.graphSubject ?? null,
          graph_topic_name: a.graphTopicName ?? null,
        });
        rows = [row, ...rows];
        return row;
      }
      if (cmd === "update_mistake") {
        const a = args as { id: number; payload: { isMastered?: number } };
        rows = rows.map((r) =>
          r.id === a.id
            ? { ...r, is_mastered: a.payload.isMastered ?? r.is_mastered }
            : r,
        );
        return rows.find((r) => r.id === a.id) ?? null;
      }
      if (cmd === "delete_mistake") {
        const a = args as { id: number };
        rows = rows.filter((r) => r.id !== a.id);
        return null;
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("mistakes_page_records_subject_reason_and_correct_note", async () => {
    renderMistakes();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "错题本" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("科目"), { target: { value: "化学" } });
    fireEvent.change(screen.getByLabelText("错因"), { target: { value: "审题失误" } });
    fireEvent.change(screen.getByLabelText("题目简述"), {
      target: { value: "化学平衡常数计算" },
    });
    fireEvent.change(screen.getByLabelText("正确思路（可留空）"), {
      target: { value: "先写表达式再代数值" },
    });

    fireEvent.click(screen.getByRole("button", { name: "记下来" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "create_mistake",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({
        payload: {
          subject: "化学",
          title: "化学平衡常数计算",
          reason: "审题失误",
          correctNote: "先写表达式再代数值",
          graphTopicId: null,
          graphSubject: null,
          graphTopicName: null,
        },
      });
    });

    expect(
      await screen.findByRole("heading", { name: "化学平衡常数计算" }),
    ).toBeInTheDocument();
    expect(screen.getByText("正确思路：先写表达式再代数值")).toBeInTheDocument();
  });

  it("mistakes_page_refuses_to_save_without_a_title", async () => {
    renderMistakes();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "错题本" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "记下来" }));

    expect(
      screen.getByText("写一句题目简述，别人才看得懂你记的是哪道题。"),
    ).toBeInTheDocument();
    const calls = mockedInvoke.mock.calls.filter(
      (call) => call[0] === "create_mistake",
    );
    expect(calls).toHaveLength(0);
  });

  it("mistakes_page_toggles_mastered_state", async () => {
    rows = [makeMistake({ id: 1 })];
    renderMistakes();

    const card = await screen.findByTestId("mistake-card");
    expect(card).toHaveAttribute("data-mastered", "false");

    fireEvent.click(screen.getByRole("button", { name: "标记已订正" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "update_mistake",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({ id: 1, payload: { isMastered: 1 } });
    });

    await waitFor(() => {
      expect(screen.getByTestId("mistake-card")).toHaveAttribute(
        "data-mastered",
        "true",
      );
    });
    expect(screen.getByRole("button", { name: "取消订正" })).toBeInTheDocument();
  });

  it("mistakes_page_filters_pending_and_mastered", async () => {
    rows = [
      makeMistake({ id: 1, title: "还没订正的题", is_mastered: 0 }),
      makeMistake({ id: 2, title: "已经订正的题", is_mastered: 1 }),
    ];
    renderMistakes();

    await screen.findByRole("heading", { name: "还没订正的题" });
    expect(
      screen.getByText(/共 2 条 · 已订正 1 条 · 待订正 1 条/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "未订正" }));
    expect(screen.getByRole("heading", { name: "还没订正的题" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "已经订正的题" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "已订正" }));
    expect(
      screen.getByRole("heading", { name: "已经订正的题" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "还没订正的题" }),
    ).not.toBeInTheDocument();
  });

  it("mistakes_page_shows_the_empty_state", async () => {
    renderMistakes();
    expect(
      await screen.findByText("还没有错题。做错的题记下来，复习时一眼看到。"),
    ).toBeInTheDocument();
  });

  it("mistakes_page_attaches_a_knowledge_point_from_the_graph", async () => {
    renderMistakes();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "错题本" })).toBeInTheDocument();
    });

    // 从知识图谱挑一个知识点挂上。
    fireEvent.click(await screen.findByTestId("mistake-topic-open"));
    fireEvent.click(
      await screen.findByRole("button", { name: "挂到知识点 有理数" }),
    );
    expect(await screen.findByTestId("mistake-topic-chip")).toHaveTextContent(
      "有理数",
    );

    fireEvent.change(screen.getByLabelText("题目简述"), {
      target: { value: "负数比较大小" },
    });
    fireEvent.click(screen.getByRole("button", { name: "记下来" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "create_mistake",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({
        payload: {
          // 挂了知识点以后，科目跟着知识点走，不用再手选一遍。
          subject: "数学",
          title: "负数比较大小",
          reason: "概念不清",
          correctNote: "",
          graphTopicId: "cnm_001",
          graphSubject: "math",
          graphTopicName: "有理数",
        },
      });
    });
  });

  it("mistakes_page_links_a_mistake_to_the_knowledge_point_in_the_graph", async () => {
    graphInstalled = true;
    rows = [
      makeMistake({
        id: 1,
        graph_topic_id: "cnm_001",
        graph_subject: "math",
        graph_topic_name: "有理数",
      }),
    ];
    renderMistakes();

    const link = await screen.findByTestId("mistake-topic-link");
    expect(link).toHaveTextContent("有理数");
    fireEvent.click(link);

    await waitFor(() => {
      const location = screen.getByTestId("location").textContent ?? "";
      expect(location).toContain("/toolbox/plugins/cn-knowledge-graph");
      expect(location).toContain("subject=math");
      expect(location).toContain("topic=cnm_001");
    });
  });

  it("mistakes_page_keeps_the_knowledge_point_as_a_plain_tag_without_the_graph_plugin", async () => {
    graphInstalled = false;
    rows = [
      makeMistake({
        id: 1,
        graph_topic_id: "cnm_001",
        graph_subject: "math",
        graph_topic_name: "有理数",
      }),
    ];
    renderMistakes();

    // 没装图谱插件就不给链接，免得点进去是死路。
    expect(await screen.findByTestId("mistake-topic-tag")).toHaveTextContent(
      "有理数",
    );
    expect(screen.queryByTestId("mistake-topic-link")).not.toBeInTheDocument();
  });

  it("mistakes_page_prefills_the_form_from_a_deep_link", async () => {
    renderMistakes([
      "/mistakes?graphTopic=cnm_001&graphSubject=math&graphSubjectName=%E6%95%B0%E5%AD%A6&graphTopicName=%E6%9C%89%E7%90%86%E6%95%B0",
    ]);

    // 从知识图谱点「记一条」跳过来的，知识点和科目都已经带上了。
    expect(await screen.findByTestId("mistake-topic-chip")).toHaveTextContent(
      "有理数",
    );
    expect(screen.getByLabelText("科目")).toHaveValue("数学");
  });

  it("mistakes_page_hints_at_prerequisites_only_for_structure_reasons", async () => {
    rows = [
      makeMistake({
        id: 1,
        title: "结构性的错",
        reason: "概念不清",
        graph_topic_id: "cnm_001",
        graph_subject: "math",
        graph_topic_name: "有理数",
      }),
      makeMistake({
        id: 2,
        title: "执行层的错",
        reason: "审题失误",
        graph_topic_id: "cnm_001",
        graph_subject: "math",
        graph_topic_name: "有理数",
      }),
    ];
    renderMistakes();

    await screen.findByRole("heading", { name: "结构性的错" });
    const hint = "这类错因多半是前面没学扎实，点上面的知识点看看它的前置关系。";
    // 只有指向知识结构的错因才引图谱，执行层的问题不添噪音。
    expect(screen.getAllByText(hint)).toHaveLength(1);
  });

  it("mistakes_page_only_loads_knowledge_points_when_the_picker_is_opened", async () => {
    renderMistakes();
    await screen.findByRole("heading", { name: "错题本" });

    // 一个学科包八百多个点，后端每次都要整包解析。
    // 用户不展开就别去拉。
    expect(
      mockedInvoke.mock.calls.filter(
        (call) => call[0] === "list_plugin_knowledge_points",
      ),
    ).toHaveLength(0);

    fireEvent.click(await screen.findByTestId("mistake-topic-open"));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "list_plugin_knowledge_points",
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it("mistakes_page_tells_the_user_when_marking_mastered_fails", async () => {
    rows = [makeMistake({ id: 1 })];
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_mistakes") return rows;
      if (cmd === "list_plugins") return [];
      if (cmd === "list_plugin_knowledge_packs") return PACKS;
      if (cmd === "update_mistake") throw new Error("数据库被锁住了");
      return null;
    });

    renderMistakes();
    await screen.findByTestId("mistake-card");

    fireEvent.click(screen.getByRole("button", { name: "标记已订正" }));

    // 失败了要说一声，不然用户以为改成了。
    expect(await screen.findByTestId("mistake-action-error")).toHaveTextContent(
      "没能更新订正状态",
    );
  });
});
