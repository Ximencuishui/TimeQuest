import { useTaskPrerequisiteConflicts } from "../hooks/useKnowledgeGraph";
import { KNOWLEDGE_GRAPH_PLUGIN_ID } from "../lib/constants";

/**
 * 排期建议：先修还没学完就排了后面的地方。
 *
 * 没问题的时候整块不出现，不占地方。后端是纯读的，读不到图谱也只是返回空列表。
 */
export function PrerequisiteAdvice({ taskId }: { taskId: number | null }) {
  const { data, isLoading } = useTaskPrerequisiteConflicts(
    KNOWLEDGE_GRAPH_PLUGIN_ID,
    taskId,
  );
  const conflicts = Array.isArray(data) ? data : [];

  if (isLoading || conflicts.length === 0) return null;

  return (
    <section className="mt-8" aria-label="排期建议">
      <h2 className="mb-3 font-display text-lg">排期建议</h2>
      <ul className="space-y-2">
        {conflicts.map((conflict, index) => (
          <li
            key={`${conflict.topicId}-${conflict.prerequisiteId}-${index}`}
            className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] text-orange-200">
                {conflict.kind === "order_swapped" ? "顺序反了" : "先修没学完"}
              </span>
              <p className="min-w-0 flex-1 text-sm text-orange-100">
                {conflict.message}
              </p>
            </div>
            {conflict.kind === "prerequisite_task_incomplete" &&
            conflict.prerequisiteTaskTitle ? (
              <p
                className="mt-1 pl-1 text-xs text-orange-200/70"
                aria-label="先修任务"
              >
                先修任务：{conflict.prerequisiteTaskTitle}
                {conflict.prerequisiteTaskRemaining != null
                  ? `（还差 ${conflict.prerequisiteTaskRemaining} 课）`
                  : ""}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
