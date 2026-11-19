import { useEffect, useMemo, useState } from "react";
import {
  GRAPH_FONT_SIZE,
  GRAPH_NODE_PADDING,
  buildPrerequisiteGraph,
  isHardStrength,
  layoutPrerequisiteGraph,
  truncateToWidth,
  type PlacedNode,
} from "../lib/prerequisiteGraph";
import type { PrerequisiteResult } from "../types";

/** 焦点节点的样子。 */
const FOCUS_FILL = "#3a2412";
const FOCUS_STROKE = "#f97316";
const FOCUS_TEXT = "#fb923c";
/** 普通先修节点的样子。 */
const NODE_FILL = "#243040";
const NODE_STROKE = "#f97316";
const NODE_TEXT = "#e8eef4";
/** 软边节点和深层前置的样子，压暗一档。 */
const SOFT_FILL = "#1a222c";
const SOFT_STROKE = "#3a4a5c";
const SOFT_TEXT = "#8b9aab";
/** 连线的颜色。 */
const EDGE_HARD = "#f97316";
const EDGE_SOFT = "#3a4a5c";

/**
 * 单个知识点的前置关系图。
 *
 * 数据全部来自 M1 的 `list_plugin_prerequisites`：中心节点 + 直接先修 + 深层前置。
 * 第 1 层的边是精确的（直接先修本来就是中心的先修）；深层前置上游只给了跳数，
 * 没给父子关系，所以按层带状连接，不假装精确。
 *
 * 点任意节点可以以它为中心重新展开，这就是「局部展开」——不做全局力导向图。
 */
export function PrerequisiteGraph({
  result,
  onSelectTopic,
}: {
  result: PrerequisiteResult | null;
  onSelectTopic?: (topicId: string) => void;
}) {
  const [deepOpen, setDeepOpen] = useState(false);
  const graph = useMemo(() => buildPrerequisiteGraph(result), [result]);
  const focusId = graph?.focus.id ?? "";
  const layout = useMemo(
    () => layoutPrerequisiteGraph(graph, { includeDeep: deepOpen }),
    [graph, deepOpen],
  );

  // 换中心了，深层前置重新收起来，别一上来糊一大片。
  useEffect(() => {
    setDeepOpen(false);
  }, [focusId]);

  if (!graph) return null;

  const hasDeep = graph.ancestorCount > 0;

  return (
    <section className="rounded-xl border border-white/10 bg-surface-3 p-3" aria-label="前置关系图">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-ink">前置关系图</h4>
        <p className="text-[10px] text-ink-muted">
          实线=硬门槛，虚线=有帮助；点节点可展开它的先修
        </p>
      </div>

      {graph.directCount === 0 && graph.ancestorCount === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">
          没有记录先修关系，这个知识点可以直接学。
        </p>
      ) : (
        <>
          <div className="mt-2 overflow-x-auto">
            <svg
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              role="img"
              aria-label={`${graph.focus.name} 的前置关系图`}
              className="block"
            >
              {layout.edges.map((edge) => (
                <path
                  key={edge.id}
                  d={edge.d}
                  data-edge-id={edge.id}
                  data-edge-kind={edge.kind}
                  fill="none"
                  stroke={
                    edge.kind === "band"
                      ? EDGE_SOFT
                      : isHardStrength(edge.strength)
                        ? EDGE_HARD
                        : EDGE_SOFT
                  }
                  strokeWidth={edge.kind === "band" ? 1.2 : 1.6}
                  strokeDasharray={
                    edge.kind === "band"
                      ? "3 3"
                      : isHardStrength(edge.strength)
                        ? undefined
                        : "4 3"
                  }
                />
              ))}
              {layout.nodes.map((placed) => (
                <GraphNode
                  key={placed.node.id}
                  placed={placed}
                  onSelect={onSelectTopic}
                />
              ))}
            </svg>
          </div>

          {hasDeep ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label={
                  deepOpen
                    ? `收起深层前置（${graph.ancestorCount} 个）`
                    : `展开深层前置（${graph.ancestorCount} 个）`
                }
                className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-ink-muted transition hover:text-ink"
                onClick={() => setDeepOpen((current) => !current)}
              >
                {deepOpen ? "收起深层前置" : `展开深层前置（${graph.ancestorCount} 个）`}
              </button>
              <p className="text-[10px] text-ink-muted">
                {deepOpen
                  ? `沿硬门槛回溯到第 ${graph.maxAncestorDepth} 层，层间父子关系上游没给，只按层连`
                  : "深层前置默认收起，展开后按层显示"}
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/** 图上的一个节点。焦点节点不可点，先修节点点了就以它为中心展开。 */
function GraphNode({
  placed,
  onSelect,
}: {
  placed: PlacedNode;
  onSelect?: (topicId: string) => void;
}) {
  const { node } = placed;
  const isFocus = node.kind === "focus";
  const hard = isHardStrength(node.strength);
  const fill = isFocus ? FOCUS_FILL : hard || node.kind === "direct" ? NODE_FILL : SOFT_FILL;
  const stroke = isFocus ? FOCUS_STROKE : hard ? NODE_STROKE : SOFT_STROKE;
  const text = isFocus ? FOCUS_TEXT : hard ? NODE_TEXT : SOFT_TEXT;
  const label = truncateToWidth(
    node.name,
    placed.width - GRAPH_NODE_PADDING * 2,
    GRAPH_FONT_SIZE,
  );
  const hint = [node.name, node.reason].filter(Boolean).join(" · ");

  if (isFocus) {
    return (
      <g aria-label={`当前知识点 ${node.name}`}>
        <title>{hint}</title>
        <rect
          x={placed.x}
          y={placed.y}
          width={placed.width}
          height={placed.height}
          rx={10}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.6}
        />
        <text
          x={placed.x + placed.width / 2}
          y={placed.y + placed.height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={GRAPH_FONT_SIZE}
          fill={text}
        >
          {label}
        </text>
      </g>
    );
  }

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`前置知识点 ${node.name}`}
      className="cursor-pointer"
      onClick={() => onSelect?.(node.id)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect?.(node.id);
      }}
    >
      <title>{hint}</title>
      <rect
        x={placed.x}
        y={placed.y}
        width={placed.width}
        height={placed.height}
        rx={10}
        fill={fill}
        stroke={stroke}
        strokeWidth={hard ? 1.4 : 1}
        strokeDasharray={hard ? undefined : "4 3"}
      />
      <text
        x={placed.x + placed.width / 2}
        y={placed.y + placed.height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={GRAPH_FONT_SIZE}
        fill={text}
      >
        {label}
      </text>
    </g>
  );
}
