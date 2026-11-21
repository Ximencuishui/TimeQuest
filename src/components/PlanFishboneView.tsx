import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FISHBONE_MAX_LEAVES,
  layoutFishbone,
  truncateLabel,
} from "../lib/planViews";
import type { Task } from "../types";
import { EmptyPlan } from "./PlanCalendarView";

type Props = {
  tasks: Task[];
};

const ACCENT = "#f97316";
const ACCENT_SOFT = "#fb923c";
const SPINE = "#3f3f46";
const RIB = "#52525b";
const TEXT_MUTED = "#8b9aab";
const LABEL_FILL = "#3a2412";

/**
 * 总计划的鱼骨图：主干是「总计划」，肋骨是学科，骨上挂课本，课本下挂任务。
 *
 * 用来看「计划是怎么拆下来的」——哪一科、哪本书、哪一轮，一眼看得出结构，
 * 避免把时间摊在几个互不相干的清单上。
 */
export function PlanFishboneView({ tasks }: Props) {
  const navigate = useNavigate();
  const layout = useMemo(() => layoutFishbone(tasks), [tasks]);

  if (tasks.length === 0) {
    return <EmptyPlan text="当前筛选下没有任务，换个标签或先建一条主线。" />;
  }

  return (
    <section data-testid="plan-fishbone-view" aria-label="总计划鱼骨图">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-ink-muted">
        <span>主干 = 总计划</span>
        <span>肋骨 = 学科</span>
        <span>骨枝 = 课本</span>
        <span>叶子 = 任务（点开看详情）</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/5 bg-surface-2/50 p-3">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="总计划鱼骨图"
          className="block"
        >
          {/* 主干 */}
          <line
            x1={layout.spineStart}
            y1={layout.spineY}
            x2={layout.spineEnd}
            y2={layout.spineY}
            stroke={SPINE}
            strokeWidth={4}
            strokeLinecap="round"
          />
          <polygon
            points={`${layout.spineEnd},${layout.spineY} ${layout.spineEnd - 16},${
              layout.spineY - 7
            } ${layout.spineEnd - 16},${layout.spineY + 7}`}
            fill={SPINE}
          />
          <text
            x={16}
            y={layout.spineY + 4}
            fill={ACCENT_SOFT}
            fontSize={13}
            fontWeight={600}
          >
            总计划
          </text>

          {layout.ribs.map((rib) => {
            const subjectTasks =
              rib.books.reduce((sum, book) => sum + book.leaves.length, 0) || 0;
            const showLeafLabels = subjectTasks <= 4;
            const label = truncateLabel(rib.subject, 8);
            const labelWidth = label.length * 13 + 18;
            return (
              <g key={rib.subject}>
                <line
                  x1={rib.anchorX}
                  y1={layout.spineY}
                  x2={rib.endX}
                  y2={rib.endY}
                  stroke={RIB}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                <rect
                  x={rib.endX - labelWidth / 2}
                  y={rib.endY - 13}
                  width={labelWidth}
                  height={26}
                  rx={13}
                  fill={LABEL_FILL}
                  stroke={ACCENT}
                  strokeWidth={1.4}
                />
                <text
                  x={rib.endX}
                  y={rib.endY + 4}
                  textAnchor="middle"
                  fill={ACCENT_SOFT}
                  fontSize={13}
                  fontWeight={600}
                >
                  {label}
                </text>

                {rib.books.map((book) => (
                  <g key={`${rib.subject}-${book.textbook}`}>
                    <line
                      x1={book.baseX}
                      y1={book.baseY}
                      x2={book.x}
                      y2={book.y}
                      stroke={RIB}
                      strokeWidth={1.4}
                      strokeLinecap="round"
                    />
                    <text
                      x={book.x + 6}
                      y={book.y}
                      dominantBaseline="middle"
                      fill={TEXT_MUTED}
                      fontSize={11}
                    >
                      {truncateLabel(book.textbook, 10)}
                    </text>

                    {book.leaves.map((leaf) => (
                      <g
                        key={leaf.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`打开任务 ${leaf.title}`}
                        className="cursor-pointer"
                        onClick={() => navigate(`/tasks/${leaf.id}`)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          navigate(`/tasks/${leaf.id}`);
                        }}
                      >
                        <title>{leaf.title}</title>
                        <circle
                          cx={leaf.x}
                          cy={leaf.y}
                          r={4.5}
                          fill={leaf.color || ACCENT}
                          stroke="#18181b"
                          strokeWidth={1}
                        />
                        {showLeafLabels ? (
                          <text
                            x={leaf.x + 8}
                            y={leaf.y}
                            dominantBaseline="middle"
                            fill="#e8eef4"
                            fontSize={10}
                          >
                            {truncateLabel(leaf.title, 8)}
                          </text>
                        ) : null}
                      </g>
                    ))}
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {tasks.length > FISHBONE_MAX_LEAVES ? (
        <p className="mt-2 text-[11px] text-ink-muted">
          同一本课本下任务较多时，叶子只画前 {FISHBONE_MAX_LEAVES} 个，其余在列表视图里看。
        </p>
      ) : null}
    </section>
  );
}
