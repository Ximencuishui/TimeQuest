import { describe, expect, it } from "vitest";
import {
  buildPrerequisiteGraph,
  estimateTextWidth,
  GRAPH_FOCUS_CENTER_WIDTH,
  layoutPrerequisiteGraph,
  sortGraphNodes,
  truncateToWidth,
  type PrerequisiteGraphNode,
} from "../prerequisiteGraph";
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

function node(
  id: string,
  name: string,
  strength: string,
  depth: number,
): PrerequisiteResult["direct"][number] {
  return { topic: topic(id, name), strength, reason: `理由 ${name}`, depth };
}

function result(partial: Partial<PrerequisiteResult> = {}): PrerequisiteResult {
  return {
    topic: topic("cnm_001", "有理数"),
    direct: [],
    ancestors: [],
    ...partial,
  };
}

describe("prerequisite graph", () => {
  it("prerequisite_graph_splits_direct_and_deep_prerequisites_into_layers", () => {
    const graph = buildPrerequisiteGraph(
      result({
        direct: [node("cnm_002", "相反数", "hard", 1)],
        ancestors: [
          node("cnm_003", "数轴", "hard", 2),
          node("cnm_004", "绝对值", "hard", 3),
        ],
      }),
    );

    expect(graph).not.toBeNull();
    expect(graph?.layers.map((layer) => layer.depth)).toEqual([0, 1, 2, 3]);
    expect(graph?.directCount).toBe(1);
    expect(graph?.ancestorCount).toBe(2);
    expect(graph?.maxAncestorDepth).toBe(3);
    expect(graph?.focus.id).toBe("cnm_001");
    expect(graph?.layers[1]?.nodes[0]?.kind).toBe("direct");
    expect(graph?.layers[2]?.nodes[0]?.kind).toBe("ancestor");
  });

  it("prerequisite_graph_keeps_the_focus_out_of_its_own_layers", () => {
    // 上游数据成环时，中心不该出现在自己的先修里。
    const graph = buildPrerequisiteGraph(
      result({
        direct: [node("cnm_002", "相反数", "hard", 1)],
        ancestors: [node("cnm_001", "有理数", "hard", 2)],
      }),
    );

    expect(graph?.ancestorCount).toBe(0);
    expect(graph?.layers.flatMap((layer) => layer.nodes.map((n) => n.id))).toEqual([
      "cnm_001",
      "cnm_002",
    ]);
  });

  it("prerequisite_graph_prefers_the_direct_entry_when_a_topic_appears_twice", () => {
    const graph = buildPrerequisiteGraph(
      result({
        direct: [node("cnm_002", "相反数", "hard", 1)],
        ancestors: [node("cnm_002", "相反数", "hard", 2)],
      }),
    );

    expect(graph?.directCount).toBe(1);
    expect(graph?.ancestorCount).toBe(0);
  });

  it("prerequisite_graph_sorts_hard_before_soft_inside_a_layer", () => {
    const graph = buildPrerequisiteGraph(
      result({
        direct: [
          node("cnm_003", "软先修", "soft", 1),
          node("cnm_002", "硬先修", "hard", 1),
        ],
      }),
    );

    expect(graph?.layers[1]?.nodes.map((n) => n.name)).toEqual(["硬先修", "软先修"]);
  });

  it("prerequisite_graph_returns_nothing_without_a_result", () => {
    expect(buildPrerequisiteGraph(null)).toBeNull();
    expect(buildPrerequisiteGraph(undefined)).toBeNull();
  });

  it("prerequisite_graph_layout_places_layers_from_top_to_bottom", () => {
    const graph = buildPrerequisiteGraph(
      result({
        direct: [node("cnm_002", "相反数", "hard", 1)],
        ancestors: [node("cnm_003", "数轴", "hard", 2)],
      }),
    );
    const layout = layoutPrerequisiteGraph(graph);

    expect(layout.layers.map((layer) => layer.depth)).toEqual([0, 1, 2]);
    expect(layout.layers[0].y).toBeLessThan(layout.layers[1].y);
    expect(layout.layers[1].y).toBeLessThan(layout.layers[2].y);
    // 中心节点横向居中于直接先修那一层。
    const focus = layout.nodes.find((item) => item.node.kind === "focus");
    const directs = layout.nodes.filter((item) => item.node.kind === "direct");
    expect(focus).toBeDefined();
    expect(directs).toHaveLength(1);
    const layerCenter = directs[0]!.x + directs[0]!.width / 2;
    expect(focus!.x + focus!.width / 2).toBeCloseTo(layerCenter, 0);
  });

  it("prerequisite_graph_layout_widens_nodes_for_longer_names", () => {
    const short = buildPrerequisiteGraph(
      result({ direct: [node("cnm_002", "数轴", "hard", 1)] }),
    );
    const long = buildPrerequisiteGraph(
      result({
        direct: [
          node("cnm_003", "综合运用全等判定与规范书写", "hard", 1),
        ],
      }),
    );

    const shortWidth =
      layoutPrerequisiteGraph(short).nodes.find((item) => item.node.kind === "direct")
        ?.width ?? 0;
    const longWidth =
      layoutPrerequisiteGraph(long).nodes.find((item) => item.node.kind === "direct")
        ?.width ?? 0;
    expect(longWidth).toBeGreaterThan(shortWidth);
    // 再长也不超过上限，名字超了才截断。
    expect(longWidth).toBeLessThanOrEqual(200);
  });

  it("prerequisite_graph_layout_keeps_the_focus_on_screen_when_the_layer_is_wide", () => {
    // 直接先修多、名字长的时候，整张图会有九百多像素宽。
    // 焦点要是跟着最宽那一层走，就会被顶到画布右边，展开的第一眼根本看不到主角。
    const graph = buildPrerequisiteGraph(
      result({
        direct: [
          node("cnm_002", "全等判定：角边角（ASA）与角角边（AAS）", "hard", 1),
          node("cnm_003", "全等判定：斜边、直角边（HL）", "hard", 1),
          node("cnm_004", "综合运用全等判定与规范书写", "hard", 1),
          node("cnm_005", "几何证明的基本格式", "hard", 1),
        ],
      }),
    );
    const layout = layoutPrerequisiteGraph(graph);
    const focus = layout.nodes.find((item) => item.node.kind === "focus");

    expect(focus).toBeDefined();
    expect(focus!.x + focus!.width / 2).toBeLessThanOrEqual(GRAPH_FOCUS_CENTER_WIDTH);
    // 图本身还是够宽，横着滚能看完所有先修。
    expect(layout.width).toBeGreaterThan(GRAPH_FOCUS_CENTER_WIDTH);
  });

  it("prerequisite_graph_layout_draws_exact_edges_only_from_the_focus_to_direct", () => {
    const graph = buildPrerequisiteGraph(
      result({
        direct: [
          node("cnm_002", "相反数", "hard", 1),
          node("cnm_005", "绝对值", "soft", 1),
        ],
        ancestors: [node("cnm_003", "数轴", "hard", 2)],
      }),
    );
    const layout = layoutPrerequisiteGraph(graph);

    const exact = layout.edges.filter((edge) => edge.kind === "exact");
    expect(exact).toHaveLength(2);
    expect(exact.every((edge) => edge.from === "cnm_001")).toBe(true);
    expect(exact.map((edge) => edge.to).sort()).toEqual(["cnm_002", "cnm_005"]);
    // 软边在图上要能看出来。
    expect(exact.find((edge) => edge.to === "cnm_005")?.strength).toBe("soft");
  });

  it("prerequisite_graph_layout_hides_deep_layers_until_they_are_expanded", () => {
    const graph = buildPrerequisiteGraph(
      result({
        direct: [node("cnm_002", "相反数", "hard", 1)],
        ancestors: [node("cnm_003", "数轴", "hard", 2)],
      }),
    );

    const collapsed = layoutPrerequisiteGraph(graph, { includeDeep: false });
    expect(collapsed.layers.map((layer) => layer.depth)).toEqual([0, 1]);
    expect(collapsed.spine).toBeNull();
    expect(collapsed.nodes.map((item) => item.node.id)).toEqual(["cnm_001", "cnm_002"]);

    const expanded = layoutPrerequisiteGraph(graph, { includeDeep: true });
    expect(expanded.layers.map((layer) => layer.depth)).toEqual([0, 1, 2]);
    // 深层前置的父子关系上游没给，只能按层带状连。
    expect(expanded.spine).not.toBeNull();
    expect(expanded.edges.filter((edge) => edge.kind === "exact")).toHaveLength(1);
    expect(expanded.edges.some((edge) => edge.kind === "band")).toBe(true);
  });

  it("prerequisite_graph_layout_keeps_every_node_inside_the_canvas", () => {
    const graph = buildPrerequisiteGraph(
      result({
        direct: [
          node("cnm_002", "相反数", "hard", 1),
          node("cnm_003", "数轴", "hard", 1),
          node("cnm_004", "绝对值", "hard", 1),
        ],
        ancestors: [node("cnm_005", "相反数的相反数", "hard", 2)],
      }),
    );
    const layout = layoutPrerequisiteGraph(graph);

    for (const item of layout.nodes) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.x + item.width).toBeLessThanOrEqual(layout.width);
      expect(item.y + item.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it("prerequisite_graph_sorts_nodes_without_touching_the_input", () => {
    const input: PrerequisiteGraphNode[] = [
      {
        id: "b",
        name: "B",
        depth: 1,
        strength: "soft",
        reason: "",
        kind: "direct",
        topic: topic("b", "B"),
      },
      {
        id: "a",
        name: "A",
        depth: 1,
        strength: "hard",
        reason: "",
        kind: "direct",
        topic: topic("a", "A"),
      },
    ];

    expect(sortGraphNodes(input).map((item) => item.id)).toEqual(["a", "b"]);
    expect(input.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("truncate_to_width_cuts_long_names_and_keeps_short_ones", () => {
    expect(truncateToWidth("有理数", 100, 12)).toBe("有理数");
    const cut = truncateToWidth("一元二次方程的根与系数的关系", 60, 12);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThan("一元二次方程的根与系数的关系".length);
    // 中文按全宽算，英文按半宽算。
    expect(estimateTextWidth("有理数", 12)).toBe(36);
    expect(estimateTextWidth("abc", 12)).toBeCloseTo(19.8);
  });

  it("truncate_to_width_keeps_a_name_that_just_fits", () => {
    // 估宽与可用宽只差零点几个像素时不该被砍：上游名字常带括号，砍一半就成「（HL」了。
    const name = "全等判定：斜边、直角边（HL）";
    expect(truncateToWidth(name, Math.floor(estimateTextWidth(name, 12)), 12)).toBe(name);

    // 真塞不下时，尾部不留孤零零的开括号。
    const cut = truncateToWidth("全等判定：角边角（ASA）与角角边（AAS）", 140, 12);
    expect(cut.endsWith("…")).toBe(true);
    expect(/[（(【《「『]$/.test(cut.slice(0, -1))).toBe(false);
  });
});
