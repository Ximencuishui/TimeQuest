import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrerequisiteGraph } from "../PrerequisiteGraph";
import type { KnowledgeTopic, PrerequisiteResult } from "../../types";

function topic(id: string, name: string): KnowledgeTopic {
  return {
    id,
    name,
    domain: "数与代数",
    grade: 7,
    stage: "初中",
    semester: "上",
    chapter: "七上 第一章",
    type: "conceptual",
    description: "",
    masteryCriteria: [],
    diagnosticQuestion: null,
    mathLinks: [],
  };
}

const FOCUS = topic("cnm_001", "有理数");
const DIRECT = topic("cnm_002", "相反数");
const SOFT = topic("cnm_005", "数轴");
const DEEP = topic("cnm_003", "绝对值");

const RESULT: PrerequisiteResult = {
  topic: FOCUS,
  direct: [
    { topic: DIRECT, strength: "hard", reason: "先懂相反数", depth: 1 },
    { topic: SOFT, strength: "soft", reason: "有帮助", depth: 1 },
  ],
  ancestors: [
    { topic: DEEP, strength: "hard", reason: "再往上追一层", depth: 2 },
  ],
};

function renderGraph(result: PrerequisiteResult | null = RESULT) {
  const onSelect = vi.fn();
  const view = render(
    <PrerequisiteGraph result={result} onSelectTopic={onSelect} />,
  );
  return { ...view, onSelect };
}

describe("PrerequisiteGraph", () => {
  afterEach(() => {
    cleanup();
  });

  it("prerequisite_graph_shows_the_focus_and_its_direct_prerequisites", () => {
    renderGraph();

    expect(screen.getByLabelText("当前知识点 有理数")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "前置知识点 相反数" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "前置知识点 数轴" })).toBeInTheDocument();
    // 焦点节点自己不可点，不能以自己为中心再展开。
    expect(screen.queryByRole("button", { name: "前置知识点 有理数" })).not.toBeInTheDocument();
  });

  it("prerequisite_graph_distinguishes_hard_edges_from_soft_ones", () => {
    const { container } = renderGraph();

    const hard = container.querySelector('[aria-label="前置知识点 相反数"] rect');
    const soft = container.querySelector('[aria-label="前置知识点 数轴"] rect');
    expect(hard?.getAttribute("stroke-dasharray")).toBeNull();
    expect(soft?.getAttribute("stroke-dasharray")).toBe("4 3");
  });

  it("prerequisite_graph_draws_hard_edges_solid_and_soft_edges_dashed", () => {
    const { container } = renderGraph();

    // 连线本身也要分得清：硬门槛实线、软边虚线。
    const hard = container.querySelector('[data-edge-id="exact:cnm_001->cnm_002"]');
    const soft = container.querySelector('[data-edge-id="exact:cnm_001->cnm_005"]');
    expect(hard).not.toBeNull();
    expect(soft).not.toBeNull();
    expect(hard?.getAttribute("stroke-dasharray")).toBeNull();
    expect(soft?.getAttribute("stroke-dasharray")).toBe("4 3");
  });

  it("prerequisite_graph_collapses_deep_prerequisites_until_they_are_expanded", () => {
    renderGraph();

    expect(screen.queryByRole("button", { name: "前置知识点 绝对值" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /展开深层前置/ }));

    expect(screen.getByRole("button", { name: "前置知识点 绝对值" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /收起深层前置/ })).toBeInTheDocument();
  });

  it("prerequisite_graph_calls_back_when_a_prerequisite_node_is_clicked", () => {
    const { onSelect } = renderGraph();

    fireEvent.click(screen.getByRole("button", { name: "前置知识点 相反数" }));

    expect(onSelect).toHaveBeenCalledWith("cnm_002");
  });

  it("prerequisite_graph_says_so_when_there_is_no_prerequisite_at_all", () => {
    renderGraph({ topic: FOCUS, direct: [], ancestors: [] });

    expect(screen.getByText("没有记录先修关系，这个知识点可以直接学。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /展开深层前置/ })).not.toBeInTheDocument();
  });
});
