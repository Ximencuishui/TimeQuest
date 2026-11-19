import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KnowledgePackEntry,
  KnowledgeTopic,
  PrerequisiteResult,
  TopicMistakes,
} from "../../types";
import { PluginKnowledgeLibrary } from "../PluginKnowledgeLibrary";

const mockedInvoke = vi.mocked(invoke);

const PLUGIN_ID = "cn-knowledge-graph";

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
    masteryCriteria: ["能说出正负数的含义"],
    diagnosticQuestion: { question: "−3 是什么数？", answer: "负数" },
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
    description: "只有符号不同的两个数",
    masteryCriteria: [],
    diagnosticQuestion: null,
    mathLinks: [],
  },
  {
    id: "cnp_001",
    name: "匀速直线运动",
    domain: "运动和相互作用",
    grade: 8,
    stage: "初中",
    semester: "上",
    chapter: "八上 第一章",
    type: "conceptual",
    description: "",
    masteryCriteria: [],
    diagnosticQuestion: null,
    mathLinks: [{ id: "cnm_010", reason: "要用到正负数" }],
  },
];

const PREREQUISITES: PrerequisiteResult = {
  topic: TOPICS[0],
  direct: [
    { topic: TOPICS[1], strength: "hard", reason: "先懂相反数", depth: 1 },
  ],
  ancestors: [
    { topic: TOPICS[2], strength: "hard", reason: "再往上追一层", depth: 2 },
  ],
};

/** 换个中心就该换个先修链，不然图上画的还是上一个知识点的关系。 */
const PREREQUISITES_BY_TOPIC: Record<string, PrerequisiteResult> = {
  cnm_001: PREREQUISITES,
  cnm_002: {
    topic: TOPICS[1],
    direct: [
      { topic: TOPICS[0], strength: "hard", reason: "相反数要用到有理数", depth: 1 },
    ],
    ancestors: [],
  },
};

/**
 * 某个知识点上记过的错题。
 *
 * 字段名必须跟后端 `TopicMistakes` 序列化出来的一致（snake_case）。
 * Rust 那边有 `frontend_types_match_the_serialized_field_names` 把这条钉死：
 * 后端一旦改成 camelCase，前端读到的就是 undefined，而且不报错。
 *
 * 故意让两个知识点错开：`cnm_001` 有错题，`cnm_002` 一条没有，
 * 这样「有错题」和「没错题」两条分支都能各自验到。
 */
const TOPIC_MISTAKES_BY_TOPIC: Record<string, TopicMistakes> = {
  cnm_001: {
    topic_id: "cnm_001",
    topic_name: "有理数",
    total: 2,
    pending: 1,
    items: [
      {
        id: 11,
        subject: "数学",
        title: "负数比较大小",
        reason: "概念不清",
        correct_note: "",
        is_mastered: 0,
        created_at: "2026-11-18 10:00:00",
      },
      {
        id: 12,
        subject: "数学",
        title: "有理数加减",
        reason: "计算失误",
        correct_note: "",
        is_mastered: 1,
        created_at: "2026-11-18 11:00:00",
      },
    ],
  },
  cnm_002: {
    topic_id: "cnm_002",
    topic_name: "相反数",
    total: 0,
    pending: 0,
    items: [],
  },
};

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

function renderLibrary(
  props: { initialSubject?: string; initialTopicId?: string } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PluginKnowledgeLibrary pluginId={PLUGIN_ID} {...props} />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** 某个命令的调用参数列表。 */
function callsOf(command: string) {
  return mockedInvoke.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => call[1] as Record<string, unknown>);
}

describe("PluginKnowledgeLibrary", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(listen).mockReset();
    vi.mocked(listen).mockImplementation(async () => () => undefined);
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "list_plugin_knowledge_packs") return PACKS;
      if (cmd === "list_plugin_knowledge_points") return TOPICS;
      if (cmd === "list_plugin_prerequisites") {
        const topicId = (args as { topicId?: string } | undefined)?.topicId ?? "cnm_001";
        return PREREQUISITES_BY_TOPIC[topicId] ?? PREREQUISITES;
      }
      if (cmd === "list_topic_mistakes") {
        const topicId = (args as { topicId?: string } | undefined)?.topicId ?? "cnm_001";
        return (
          TOPIC_MISTAKES_BY_TOPIC[topicId] ?? {
            topic_id: topicId,
            topic_name: "",
            total: 0,
            pending: 0,
            items: [],
          }
        );
      }
      if (cmd === "download_plugin_knowledge_pack") {
        return {
          subject: "english",
          name: "英语",
          prefix: "cne_",
          count: 791,
        };
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("knowledge_library_lists_packs_and_picks_a_builtin_subject_by_default", async () => {
    renderLibrary();

    expect(await screen.findByRole("button", { name: /数学 870/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /物理 269/ })).toBeInTheDocument();
    // 数学和物理都内置，两个「已内置」徽标。
    expect(screen.getAllByText("已内置")).toHaveLength(2);
    expect(screen.getByText("需下载")).toBeInTheDocument();

    // 默认落在内置的数学上，不去点还没下载的英语。
    await waitFor(() => {
      const calls = callsOf("list_plugin_knowledge_points");
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]?.subject).toBe("math");
    });
  });

  it("knowledge_library_filters_topics_by_stage", async () => {
    renderLibrary();

    await screen.findByRole("button", { name: /有理数/ });
    fireEvent.click(screen.getByRole("tab", { name: "初中" }));

    await waitFor(() => {
      const calls = callsOf("list_plugin_knowledge_points");
      expect(calls.some((call) => call.stage === "初中")).toBe(true);
    });
  });

  it("knowledge_library_searches_topics_by_keyword", async () => {
    renderLibrary();

    await screen.findByRole("button", { name: /有理数/ });
    fireEvent.change(screen.getByLabelText("搜索知识点"), {
      target: { value: "相反数" },
    });

    await waitFor(() => {
      const calls = callsOf("list_plugin_knowledge_points");
      expect(calls.some((call) => call.query === "相反数")).toBe(true);
    });
  });

  it("knowledge_library_shows_direct_and_deep_prerequisites", async () => {
    renderLibrary();

    fireEvent.click(await screen.findByRole("button", { name: /有理数/ }));

    await waitFor(() => {
      const calls = callsOf("list_plugin_prerequisites");
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]).toMatchObject({
        pluginId: PLUGIN_ID,
        subject: "math",
        topicId: "cnm_001",
      });
    });

    expect(await screen.findByRole("heading", { name: "有理数" })).toBeInTheDocument();
    expect(screen.getByText("直接先修")).toBeInTheDocument();
    expect(screen.getByText("深层前置（沿硬门槛回溯）")).toBeInTheDocument();
    // 直接先修和深层前置都是硬门槛，两处徽标都在。
    expect(screen.getAllByText("硬门槛")).toHaveLength(2);
    expect(screen.getByText("先懂相反数")).toBeInTheDocument();
  });

  it("knowledge_library_recenters_the_graph_on_a_clicked_prerequisite", async () => {
    renderLibrary();

    fireEvent.click(await screen.findByRole("button", { name: /有理数/ }));
    await waitFor(() => {
      expect(callsOf("list_plugin_prerequisites").length).toBeGreaterThan(0);
    });

    // 点图上的先修节点，以它为中心重新展开。
    fireEvent.click(
      await screen.findByRole("button", { name: "前置知识点 相反数" }),
    );

    await waitFor(() => {
      const calls = callsOf("list_plugin_prerequisites");
      expect(calls.some((call) => call.topicId === "cnm_002")).toBe(true);
    });
    expect(screen.getByRole("button", { name: "返回上一个知识点" })).toBeInTheDocument();
  });

  it("knowledge_library_goes_back_to_the_previous_topic", async () => {
    renderLibrary();

    fireEvent.click(await screen.findByRole("button", { name: /有理数/ }));
    expect(await screen.findByRole("heading", { name: "有理数" })).toBeInTheDocument();

    // 点图上的先修节点，以它为中心。
    fireEvent.click(
      await screen.findByRole("button", { name: "前置知识点 相反数" }),
    );
    expect(await screen.findByRole("heading", { name: "相反数" })).toBeInTheDocument();

    // 「返回」退回刚才看的那一个。
    fireEvent.click(screen.getByRole("button", { name: "返回上一个知识点" }));
    expect(await screen.findByRole("heading", { name: "有理数" })).toBeInTheDocument();
    // 退到最初那个，就没有上一个了。
    expect(
      screen.queryByRole("button", { name: "返回上一个知识点" }),
    ).not.toBeInTheDocument();
  });

  it("knowledge_library_goes_back_to_the_last_visited_topic_even_after_revisiting_one", async () => {
    renderLibrary();

    fireEvent.click(await screen.findByRole("button", { name: /有理数/ }));
    await screen.findByRole("heading", { name: "有理数" });

    // 有理数 → 相反数 → 又点回有理数。
    fireEvent.click(
      await screen.findByRole("button", { name: "前置知识点 相反数" }),
    );
    await screen.findByRole("heading", { name: "相反数" });
    fireEvent.click(
      await screen.findByRole("button", { name: "前置知识点 有理数" }),
    );
    await screen.findByRole("heading", { name: "有理数" });

    // 按访问顺序，返回应该退到「相反数」，而不是停在「有理数」自己。
    fireEvent.click(screen.getByRole("button", { name: "返回上一个知识点" }));
    expect(await screen.findByRole("heading", { name: "相反数" })).toBeInTheDocument();
  });

  it("knowledge_library_downloads_an_undownloaded_subject_on_demand", async () => {
    renderLibrary();

    fireEvent.click(
      await screen.findByRole("button", { name: "下载 英语 知识点" }),
    );

    await waitFor(() => {
      const calls = callsOf("download_plugin_knowledge_pack");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        pluginId: PLUGIN_ID,
        subject: "english",
      });
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "英语 已下载，共 791 个知识点。",
    );
  });

  it("knowledge_library_reports_a_failed_download_instead_of_pretending_it_worked", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_plugin_knowledge_packs") return PACKS;
      if (cmd === "list_plugin_knowledge_points") return TOPICS;
      if (cmd === "download_plugin_knowledge_pack") {
        throw new Error("下载失败：服务器返回 500");
      }
      return null;
    });

    renderLibrary();

    fireEvent.click(
      await screen.findByRole("button", { name: "下载 英语 知识点" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "下载失败：服务器返回 500",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("knowledge_library_credits_upstream_and_shows_the_license", async () => {
    renderLibrary();

    expect(await screen.findByText(/cn-math-taxonomy/)).toBeInTheDocument();
    expect(screen.getByText(/CC BY-NC 4\.0/)).toBeInTheDocument();
  });

  it("knowledge_library_shows_the_mistakes_recorded_on_this_topic", async () => {
    renderLibrary();

    fireEvent.click(await screen.findByRole("button", { name: /有理数/ }));

    // 错题本和图谱说的是同一件事：这个知识点上我错过几次。
    expect(await screen.findByText("我在这里错过")).toBeInTheDocument();
    expect(
      screen.getByText(/错题本里在这个知识点上记了 2 道，还有 1 道没订正/),
    ).toBeInTheDocument();
    expect(screen.getByText("负数比较大小")).toBeInTheDocument();
    expect(screen.getByText("有理数加减")).toBeInTheDocument();
    // 订正状态得跟着后端给的字段走：一条订正过，一条还没。
    expect(screen.getByText("已订正")).toBeInTheDocument();
    expect(screen.getByText("待订正")).toBeInTheDocument();

    await waitFor(() => {
      const calls = callsOf("list_topic_mistakes");
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]).toMatchObject({
        pluginId: PLUGIN_ID,
        subject: "math",
        topicId: "cnm_001",
      });
    });
  });

  it("knowledge_library_sends_the_topic_over_to_the_mistake_book", async () => {
    renderLibrary();

    // 相反数这个知识点上还没记过错题，所以给一个「记一条」的入口。
    fireEvent.click(await screen.findByRole("button", { name: /相反数/ }));
    fireEvent.click(await screen.findByTestId("topic-record-mistake"));

    await waitFor(() => {
      const location = screen.getByTestId("location").textContent ?? "";
      expect(location).toContain("/mistakes?");
      expect(location).toContain("graphTopic=cnm_002");
      expect(location).toContain("graphSubject=math");
    });
  });

  it("knowledge_library_lands_on_the_topic_a_deep_link_points_at", async () => {
    renderLibrary({ initialSubject: "math", initialTopicId: "cnm_002" });

    // 错题本里点知识点跳过来，不用再自己找一遍。
    expect(await screen.findByRole("heading", { name: "相反数" })).toBeInTheDocument();
  });
});