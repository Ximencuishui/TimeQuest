import type { KnowledgeTopic, PrerequisiteNode, PrerequisiteResult } from "../types";

/** 硬门槛边的强度值。软边是「会了有帮助」，不是必须先会。 */
export const STRENGTH_HARD = "hard";

/** 图里一个节点的种类：中心、直接先修、深层前置。 */
export type PrerequisiteNodeKind = "focus" | "direct" | "ancestor";

/** 图里的一个节点。 */
export type PrerequisiteGraphNode = {
  /** 上游知识点 id。 */
  id: string;
  name: string;
  /** 到中心的跳数。0 是中心本身，1 是直接先修。 */
  depth: number;
  /** `hard` / `soft`。中心自己没有边，强度为空。 */
  strength: string;
  /** 上游给的理由文案。 */
  reason: string;
  kind: PrerequisiteNodeKind;
  topic: KnowledgeTopic;
};

/** 一层节点。同一层的跳数相同。 */
export type PrerequisiteGraphLayer = {
  depth: number;
  nodes: PrerequisiteGraphNode[];
};

/** 分层的前置关系图。 */
export type PrerequisiteGraph = {
  /** 中心节点。 */
  focus: PrerequisiteGraphNode;
  /** 从第 0 层（中心）开始，由浅到深。 */
  layers: PrerequisiteGraphLayer[];
  /** 直接先修的个数。 */
  directCount: number;
  /** 深层前置的个数。 */
  ancestorCount: number;
  /** 深层前置最深到第几层。 */
  maxAncestorDepth: number;
};

/**
 * 把 M1 的先修链结果整成一张分层图。
 *
 * 上游的先修链只给了跳数，没给「谁是谁的父节点」，所以：
 * - 第 1 层（直接先修）是中心节点的精确先修，边是准的；
 * - 第 2 层往下按跳数分层，画的时候用层带连接，不假装父子关系是精确的。
 */
export function buildPrerequisiteGraph(
  result: PrerequisiteResult | null | undefined,
): PrerequisiteGraph | null {
  if (!result || !result.topic) return null;

  const focusId = result.topic.id;
  const focus: PrerequisiteGraphNode = {
    id: focusId,
    name: result.topic.name,
    depth: 0,
    strength: "",
    reason: "",
    kind: "focus",
    topic: result.topic,
  };

  // 中心自己先进黑名单：上游数据成环时也不要把中心画成自己的先修。
  const seen = new Set<string>([focusId]);
  const byDepth = new Map<number, PrerequisiteGraphNode[]>();

  const push = (node: PrerequisiteNode | null | undefined, kind: PrerequisiteNodeKind) => {
    const topic = node?.topic;
    if (!topic) return;
    const id = topic.id.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    const depth = kind === "direct" ? 1 : Math.max(2, node?.depth ?? 2);
    const entry: PrerequisiteGraphNode = {
      id,
      name: topic.name,
      depth,
      strength: node?.strength ?? "",
      reason: node?.reason ?? "",
      kind,
      topic,
    };
    const list = byDepth.get(depth);
    if (list) list.push(entry);
    else byDepth.set(depth, [entry]);
  };

  for (const node of result.direct ?? []) push(node, "direct");
  for (const node of result.ancestors ?? []) push(node, "ancestor");

  const depths = [...byDepth.keys()].sort((left, right) => left - right);
  const layers: PrerequisiteGraphLayer[] = [
    { depth: 0, nodes: [focus] },
    ...depths.map((depth) => ({
      depth,
      nodes: sortGraphNodes(byDepth.get(depth) ?? []),
    })),
  ];

  const directCount = layers
    .filter((layer) => layer.depth === 1)
    .reduce((sum, layer) => sum + layer.nodes.length, 0);
  const ancestorCount = layers
    .filter((layer) => layer.depth >= 2)
    .reduce((sum, layer) => sum + layer.nodes.length, 0);
  const maxAncestorDepth = depths.length > 0 && depths[depths.length - 1] >= 2
    ? depths[depths.length - 1]
    : 0;

  return { focus, layers, directCount, ancestorCount, maxAncestorDepth };
}

/**
 * 同一层里的排序：硬的在前，同强度按名字排。
 *
 * 和后端 `sort_prerequisites` 一个口径，前后看到的顺序不会打架。
 */
export function sortGraphNodes(nodes: PrerequisiteGraphNode[]): PrerequisiteGraphNode[] {
  return [...nodes].sort((left, right) => {
    if (left.strength !== right.strength) return left.strength < right.strength ? -1 : 1;
    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });
}

/** 是不是硬门槛边。 */
export function isHardStrength(strength: string): boolean {
  return strength === STRENGTH_HARD;
}

/** 节点在画布上的位置。 */
export type PlacedNode = {
  node: PrerequisiteGraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** 一条连线。`exact` 是精确父子边，`band` 是整层依赖上一层。 */
export type PlacedEdge = {
  id: string;
  kind: "exact" | "band";
  /** 起点节点 id。层带连线为空。 */
  from: string;
  /** 终点节点 id。层带连线为空。 */
  to: string;
  strength: string;
  /** SVG path 的 d。 */
  d: string;
};

/** 一层在画布上的位置。 */
export type PlacedLayer = {
  depth: number;
  /** 是不是深层前置（第 2 层往下）。 */
  deep: boolean;
  /** 这一层顶部的纵坐标。 */
  y: number;
  /** 这一层中心的纵坐标。 */
  centerY: number;
  nodes: PlacedNode[];
};

/** 整张图的布局结果。 */
export type PrerequisiteLayout = {
  width: number;
  height: number;
  layers: PlacedLayer[];
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  /** 深层前置的层带竖线。没有深层前置时为空。 */
  spine: { x: number; top: number; bottom: number } | null;
};

/** 布局参数。 */
export type PrerequisiteLayoutOptions = {
  /** 节点的最小宽度。 */
  minNodeWidth?: number;
  /** 节点的最大宽度。名字再长也不超过这个。 */
  maxNodeWidth?: number;
  nodeHeight?: number;
  /** 同一层相邻节点的间距。 */
  hGap?: number;
  /** 相邻层之间的纵向间距。 */
  vGap?: number;
  /** 画布内边距。 */
  padding?: number;
  /** 焦点节点的居中基准宽度上限。 */
  focusCenterWidth?: number;
  /** 画不画深层前置。收起时只画中心和直接先修。 */
  includeDeep?: boolean;
};

export const GRAPH_NODE_HEIGHT = 40;
export const GRAPH_H_GAP = 18;
export const GRAPH_V_GAP = 58;
export const GRAPH_PADDING = 14;
export const GRAPH_FONT_SIZE = 12;
/** 节点里文字左右各留多少像素。 */
export const GRAPH_NODE_PADDING = 12;
export const GRAPH_MIN_NODE_WIDTH = 108;
export const GRAPH_MAX_NODE_WIDTH = 200;
/**
 * 焦点节点的居中基准宽度上限。
 *
 * 直接先修多的时候整张图会很宽（实测 950 px），面板只有 500 多像素。
 * 焦点要是跟着最宽的那层走，就会被顶到画布右边，展开的第一眼根本看不到主角。
 * 所以焦点单独居中：图窄时照旧居中，图宽时限在这段基准宽度内，保证落在首屏。
 */
export const GRAPH_FOCUS_CENTER_WIDTH = 480;
/** 留给层带竖线的横向空间。 */
export const GRAPH_SPINE_GUTTER = 26;

/**
 * 节点宽度按名字长短算：短的节点不占地方，长的不截断。
 *
 * 上游的知识点名有的一长一短（「几何证明的基本格式」对「综合运用全等判定与规范书写」），
 * 固定宽度会把名字砍成半个词，所以这里让宽度跟着名字走。
 */
export function measureNodeWidth(
  name: string,
  options: { minNodeWidth?: number; maxNodeWidth?: number } = {},
): number {
  const min = options.minNodeWidth ?? GRAPH_MIN_NODE_WIDTH;
  const max = options.maxNodeWidth ?? GRAPH_MAX_NODE_WIDTH;
  const text = estimateTextWidth(name, GRAPH_FONT_SIZE);
  const wanted = text + GRAPH_NODE_PADDING * 2;
  return Math.round(Math.min(max, Math.max(min, wanted)));
}

/**
 * 算图上每个节点和每条线的位置。
 *
 * 纯函数，不碰 DOM：布局规则单独能测。
 */
export function layoutPrerequisiteGraph(
  graph: PrerequisiteGraph | null,
  options: PrerequisiteLayoutOptions = {},
): PrerequisiteLayout {
  const minNodeWidth = options.minNodeWidth ?? GRAPH_MIN_NODE_WIDTH;
  const maxNodeWidth = options.maxNodeWidth ?? GRAPH_MAX_NODE_WIDTH;
  const nodeHeight = options.nodeHeight ?? GRAPH_NODE_HEIGHT;
  const hGap = options.hGap ?? GRAPH_H_GAP;
  const vGap = options.vGap ?? GRAPH_V_GAP;
  const padding = options.padding ?? GRAPH_PADDING;

  const empty: PrerequisiteLayout = {
    width: 0,
    height: 0,
    layers: [],
    nodes: [],
    edges: [],
    spine: null,
  };
  if (!graph) return empty;

  const visible = (options.includeDeep ?? true)
    ? graph.layers
    : graph.layers.filter((layer) => layer.depth <= 1);
  const hasDeep = visible.some((layer) => layer.depth >= 2);
  const gutter = hasDeep ? GRAPH_SPINE_GUTTER : 0;

  // 每层的节点宽度各自算，宽度跟着名字走。
  const layerWidths = visible.map((layer) => {
    const widths = layer.nodes.map((node) =>
      measureNodeWidth(node.name, { minNodeWidth, maxNodeWidth }),
    );
    const gaps = Math.max(0, widths.length - 1) * hGap;
    return {
      widths,
      total: widths.reduce((sum, value) => sum + value, 0) + gaps,
    };
  });
  const contentWidth = Math.max(
    minNodeWidth,
    ...layerWidths.map((item) => item.total),
  );
  const width = Math.max(320, contentWidth + 2 * padding + gutter);

  // 焦点自己一个居中基准：窄图跟着整层走，宽图限在首屏可见的那一段。
  const focusCenterWidth = Math.min(
    contentWidth,
    options.focusCenterWidth ?? GRAPH_FOCUS_CENTER_WIDTH,
  );

  const placedLayers: PlacedLayer[] = [];
  const placedNodes: PlacedNode[] = [];
  let y = padding;
  visible.forEach((layer, index) => {
    const total = layerWidths[index]?.total ?? minNodeWidth;
    const widths = layerWidths[index]?.widths ?? [];
    const alignWidth = layer.depth === 0 ? focusCenterWidth : contentWidth;
    let x = padding + gutter + (alignWidth - total) / 2;
    const nodes = layer.nodes.map((node, nodeIndex) => {
      const nodeWidth = widths[nodeIndex] ?? minNodeWidth;
      const placed: PlacedNode = {
        node,
        x,
        y,
        width: nodeWidth,
        height: nodeHeight,
      };
      placedNodes.push(placed);
      x += nodeWidth + hGap;
      return placed;
    });
    placedLayers.push({
      depth: layer.depth,
      deep: layer.depth >= 2,
      y,
      centerY: y + nodeHeight / 2,
      nodes,
    });
    y += nodeHeight + vGap;
  });

  const height = Math.max(nodeHeight + 2 * padding, y - vGap + padding);

  const edges: PlacedEdge[] = [];
  const focusLayer = placedLayers.find((layer) => layer.depth === 0);
  const directLayer = placedLayers.find((layer) => layer.depth === 1);
  const focus = focusLayer?.nodes[0];
  if (focus && directLayer) {
    for (const child of directLayer.nodes) {
      edges.push({
        id: `exact:${focus.node.id}->${child.node.id}`,
        kind: "exact",
        from: focus.node.id,
        to: child.node.id,
        strength: child.node.strength,
        d: verticalCurve(focus, child),
      });
    }
  }

  // 深层前置：上游只给了跳数，父子关系不精确，用左侧一条层带把各层串起来。
  let spine: PrerequisiteLayout["spine"] = null;
  const deepLayers = placedLayers.filter((layer) => layer.deep);
  if (deepLayers.length > 0) {
    const spineX = padding + 8;
    const top = deepLayers[0].y;
    const bottom = deepLayers[deepLayers.length - 1].y + nodeHeight;
    spine = { x: spineX, top, bottom };

    for (const layer of deepLayers) {
      const first = layer.nodes[0];
      if (!first) continue;
      edges.push({
        id: `band:${layer.depth}`,
        kind: "band",
        from: "",
        to: "",
        strength: STRENGTH_HARD,
        d: `M ${spineX} ${layer.centerY} L ${first.x - 6} ${layer.centerY}`,
      });
    }

    if (focus) {
      const focusLeft = focus.x;
      edges.push({
        id: "band:root",
        kind: "band",
        from: "",
        to: "",
        strength: STRENGTH_HARD,
        d: `M ${focusLeft} ${focus.y + focus.height / 2} L ${spineX} ${focus.y + focus.height / 2} L ${spineX} ${top}`,
      });
    }

    edges.push({
      id: "band:spine",
      kind: "band",
      from: "",
      to: "",
      strength: STRENGTH_HARD,
      d: `M ${spineX} ${top} L ${spineX} ${bottom}`,
    });
  }

  return { width, height, layers: placedLayers, nodes: placedNodes, edges, spine };
}

/** 从上层节点底部连到下层节点顶部的曲线。 */
function verticalCurve(from: PlacedNode, to: PlacedNode): string {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height;
  const x2 = to.x + to.width / 2;
  const y2 = to.y;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

/** 是不是全角字符。中文、日文按全角宽度算。 */
function isWideChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code > 0x2e80;
}

/** 估算一段文字在给定字号下的像素宽度。 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    width += isWideChar(char) ? fontSize : fontSize * 0.55;
  }
  return width;
}

/**
 * 截断文字到给定宽度，尾部补省略号。
 *
 * 估宽是近似的，上下浮动个把像素，所以留一点容差：
 * 刚好放得下的名字不该被砍（上游名字常带括号，砍一半就成「（HL」了）。
 */
export function truncateToWidth(text: string, maxWidth: number, fontSize: number): string {
  if (maxWidth <= 0) return "";
  const tolerance = 1;
  if (estimateTextWidth(text, fontSize) <= maxWidth + tolerance) return text;
  const ellipsis = "…";
  const ellipsisWidth = estimateTextWidth(ellipsis, fontSize);
  let width = 0;
  let kept = "";
  for (const char of text) {
    const charWidth = estimateTextWidth(char, fontSize);
    if (width + charWidth + ellipsisWidth > maxWidth + tolerance) break;
    width += charWidth;
    kept += char;
  }
  // 别停在开括号后面，那会留下一个孤零零的「（」。
  kept = kept.replace(/[（(【\[《「『]+$/u, "");
  return `${kept}${ellipsis}`;
}
