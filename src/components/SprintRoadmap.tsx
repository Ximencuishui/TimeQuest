import { Link } from "react-router-dom";
import { useTasks } from "../hooks/useTasks";
import {
  ROADMAP_VB,
  isRoadmapTaskComplete,
  markerPoint,
  markerProgress,
  nodeStatus,
  roadmapNodePoints,
  roadmapPathD,
  selectRoadmapTasks,
  taskProgressRatio,
  type RoadmapTask,
} from "../lib/roadmap";

const RING_R = 20;
const RING_C = 2 * Math.PI * RING_R;

function NodeRing({
  cx,
  cy,
  progress,
  status,
}: {
  cx: number;
  cy: number;
  progress: number;
  status: "done" | "active" | "idle";
}) {
  const fill =
    status === "done" ? "#166534" : status === "active" ? "#27272a" : "#18181b";
  const stroke =
    status === "done" ? "#22c55e" : status === "active" ? "#f97316" : "#52525b";
  const glow =
    status === "active"
      ? "drop-shadow(0 0 6px rgba(249, 115, 22, 0.85))"
      : status === "done"
        ? "drop-shadow(0 0 4px rgba(34, 197, 94, 0.55))"
        : undefined;
  const dashOffset = RING_C * (1 - Math.min(1, Math.max(0, progress)));

  return (
    <g style={glow ? { filter: glow } : undefined}>
      <circle cx={cx} cy={cy} r={RING_R + 4} fill={fill} stroke="#3f3f46" strokeWidth={2} />
      <circle
        cx={cx}
        cy={cy}
        r={RING_R}
        fill="none"
        stroke="#3f3f46"
        strokeWidth={3}
      />
      {progress > 0 ? (
        <circle
          cx={cx}
          cy={cy}
          r={RING_R}
          fill="none"
          stroke={stroke}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      ) : null}
      {status === "done" ? (
        <text
          x={cx}
          y={cy + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-green-400 text-[14px] font-bold"
        >
          ✓
        </text>
      ) : (
        <circle cx={cx} cy={cy} r={5} fill={status === "active" ? "#f97316" : "#52525b"} />
      )}
    </g>
  );
}

export function SprintRoadmap({ tasks }: { tasks: RoadmapTask[] }) {
  const nodes = selectRoadmapTasks(tasks);
  const points = roadmapNodePoints(nodes.length);
  const pathD = roadmapPathD(points);
  const progress = markerProgress(nodes);
  const marker = markerPoint(points, progress);
  const completed = nodes.filter(isRoadmapTaskComplete).length;

  return (
    <section
      aria-label="冲刺航线"
      className="rounded-2xl border border-white/5 bg-surface-2/90 p-5 shadow-xl shadow-black/20"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg">冲刺航线</h2>
        {nodes.length > 0 ? (
          <p className="text-xs text-ink-muted">
            {completed}/{nodes.length} 主线通关
          </p>
        ) : null}
      </div>

      {nodes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-ink-muted">
          设定你的第一个主线任务，开启冲刺航线。
          <Link to="/tasks" className="ml-1 text-accent-soft hover:underline">
            去创建
          </Link>
        </p>
      ) : (
        <div
          className="relative w-full overflow-visible"
          style={{ aspectRatio: `${ROADMAP_VB.w} / ${ROADMAP_VB.h}` }}
        >
          <svg
            viewBox={`0 0 ${ROADMAP_VB.w} ${ROADMAP_VB.h}`}
            className="absolute inset-0 h-full w-full overflow-visible"
            aria-hidden
          >
            <path
              d={pathD}
              fill="none"
              stroke="#3f3f46"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {nodes.map((task, i) => {
              const pt = points[i];
              const status = nodeStatus(task);
              return (
                <NodeRing
                  key={task.id}
                  cx={pt.x}
                  cy={pt.y}
                  progress={taskProgressRatio(task)}
                  status={status}
                />
              );
            })}
          </svg>

          {/* Labels + hit targets over the SVG */}
          {nodes.map((task, i) => {
            const pt = points[i];
            const left = (pt.x / ROADMAP_VB.w) * 100;
            const top = (pt.y / ROADMAP_VB.h) * 100;
            return (
              <Link
                key={task.id}
                to={`/tasks/${task.id}`}
                data-testid="roadmap-node"
                data-task-id={task.id}
                data-status={nodeStatus(task)}
                className="absolute z-10 flex w-20 -translate-x-1/2 flex-col items-center"
                style={{ left: `${left}%`, top: `${top}%`, marginTop: 28 }}
                title={task.title}
              >
                <span className="max-w-full truncate text-center text-[10px] leading-tight text-ink-muted">
                  {task.title}
                </span>
              </Link>
            );
          })}

          <div
            data-testid="roadmap-marker"
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 text-lg transition-all duration-1000"
            style={{
              left: `${(marker.x / ROADMAP_VB.w) * 100}%`,
              top: `${(marker.y / ROADMAP_VB.h) * 100}%`,
            }}
            aria-hidden
          >
            🚀
          </div>
        </div>
      )}
    </section>
  );
}

export function DashboardSprintRoadmap() {
  const { data } = useTasks(false);
  const tasks = Array.isArray(data) ? data : [];
  return <SprintRoadmap tasks={tasks} />;
}
