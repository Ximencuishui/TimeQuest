import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import { matchTextbook, outlinePointsBySection, outlineSectionNames } from "../lib/sectionCatalog";
import { broadcastSessionUpdated } from "../lib/widgetWindow";
import type {
  GenerateTasksFromOutlineInput,
  GenerateWeekPlanInput,
  Task,
  TaskKnowledgePoint,
} from "../types";

export function useTasks(includeArchived = false) {
  return useQuery({
    queryKey: ["tasks", includeArchived],
    queryFn: () => api.listTasks(includeArchived),
  });
}

export function useTask(id: number | null) {
  return useQuery({
    queryKey: ["task", id],
    queryFn: () => api.getTask(id!),
    enabled: id != null,
  });
}

/** 回收站：被删掉的任务，随时可以找回来。 */
export function useDeletedTasks(enabled = true) {
  return useQuery({
    queryKey: ["tasks", "deleted"],
    queryFn: () => api.listDeletedTasks(),
    enabled,
  });
}

export type TextbookSectionCatalog = {
  sections: string[];
  pointsBySection: Record<string, string[]>;
};

const EMPTY_SECTION_CATALOG: TextbookSectionCatalog = {
  sections: [],
  pointsBySection: {},
};

/** Section titles and preset points for the task's textbook. Empty when the book cannot be resolved. */
export function useTextbookSections(
  subject: string | null | undefined,
  textbook: string | null | undefined,
  title?: string | null,
) {
  const subjectName = subject?.trim() ?? "";
  const label = textbook?.trim() ?? "";
  const taskTitle = title?.trim() ?? "";
  return useQuery({
    queryKey: ["textbook-sections", subjectName, label, taskTitle],
    enabled: subjectName.length > 0 && (label.length > 0 || taskTitle.length > 0),
    queryFn: async () => {
      const books = await api.listAvailableTextbooks();
      const match = matchTextbook(
        Array.isArray(books) ? books : [],
        subjectName,
        label,
        taskTitle,
      );
      if (!match) return EMPTY_SECTION_CATALOG;
      const outline = await api.getTextbookOutline(match.subject, match.version, match.volume);
      return {
        sections: outlineSectionNames(outline),
        pointsBySection: outlinePointsBySection(outline),
      };
    },
  });
}

/** Knowledge points recorded on a task, in outline order. Empty when none were imported. */
export function useTaskKnowledgePoints(id: number | null) {
  return useQuery({
    queryKey: ["task-knowledge-points", id],
    queryFn: () => api.getTaskKnowledgePoints(id!),
    enabled: id != null,
  });
}

/** Current-round ring units from `task_progress` (not client session reduce). */
export function useTaskProgress(id: number | null) {
  return useQuery({
    queryKey: ["task-progress", id],
    queryFn: () => api.taskProgress(id!),
    enabled: id != null,
  });
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["task"] });
    qc.invalidateQueries({ queryKey: ["task-progress"] });
    qc.invalidateQueries({ queryKey: ["task-knowledge-points"] });
  };
  // 排期相关的三个缓存都得失效。
  // `sessions-range` 是总计划页日历/甘特视图的数据源，而 React Query 的前缀
  // 匹配要求第 0 个元素严格相等——`["sessions"]` 命中不了 `["sessions-range"]`，
  // 漏了它恢复/清除后排期就会停在旧数据上。
  const invalidateSessions = () => {
    qc.invalidateQueries({ queryKey: ["sessions"] });
    qc.invalidateQueries({ queryKey: ["sessions-range"] });
    qc.invalidateQueries({ queryKey: ["sessions-task"] });
  };

  const create = useMutation({
    mutationFn: (payload: Partial<Task> & { title: string; type: string }) =>
      api.createTask(payload),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<Task> }) =>
      api.updateTask(id, payload),
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      api.archiveTask(id, archived),
    onSuccess: invalidate,
  });
  // 删除任务 = 移入回收站：排期与流水都留着，只是从计划里收起来。
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteTask(id),
    onSuccess: () => {
      invalidate();
      invalidateSessions();
      qc.invalidateQueries({ queryKey: ["stats"] });
      broadcastSessionUpdated();
    },
  });
  // 从回收站找回来：任务回到原来的位置，排期与记录原样回来。
  const restoreFromTrash = useMutation({
    mutationFn: (id: number) => api.restoreTask(id),
    onSuccess: () => {
      invalidate();
      invalidateSessions();
      qc.invalidateQueries({ queryKey: ["stats"] });
      broadcastSessionUpdated();
    },
  });
  // 彻底清除：物理删除回收站里的任务，排期与记录真没了，统计要重新算。
  const purge = useMutation({
    mutationFn: (id: number) => api.purgeTask(id),
    onSuccess: () => {
      invalidate();
      invalidateSessions();
      qc.invalidateQueries({ queryKey: ["stats"] });
      broadcastSessionUpdated();
    },
  });
  const advanceRound = useMutation({
    mutationFn: (id: number) => api.advanceRound(id),
    onSuccess: invalidate,
  });
  const generateFromOutline = useMutation({
    mutationFn: (input: GenerateTasksFromOutlineInput) =>
      api.generateTasksFromOutline(input),
    onSuccess: () => {
      invalidate();
      invalidateSessions();
      qc.invalidateQueries({ queryKey: ["stats"] });
      broadcastSessionUpdated();
    },
  });

  const generateWeekPlan = useMutation({
    mutationFn: (input: GenerateWeekPlanInput) => api.generateWeekPlan(input),
    onSuccess: () => {
      invalidate();
      invalidateSessions();
      qc.invalidateQueries({ queryKey: ["stats"] });
      broadcastSessionUpdated();
    },
  });

  return {
    create,
    update,
    archive,
    remove,
    restoreFromTrash,
    purge,
    advanceRound,
    generateFromOutline,
    generateWeekPlan,
  };
}

export function useToggleKnowledgePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.toggleKnowledgePoint(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-knowledge-points"] });
    },
  });
}

export function useAddCustomKnowledgePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      taskId: number;
      sectionName: string;
      name: string;
      /** 来自知识图谱时带上上游 id，自写考点留空。 */
      graphTopicId?: string | null;
      graphSubject?: string | null;
    }) =>
      api.addCustomKnowledgePoint(input.taskId, input.sectionName, input.name, {
        topicId: input.graphTopicId ?? "",
        subject: input.graphSubject ?? null,
      }),
    onSuccess: (point) => {
      qc.setQueryData<TaskKnowledgePoint[]>(
        ["task-knowledge-points", point.task_id],
        (current) => {
          const rows = Array.isArray(current) ? current : [];
          if (rows.some((row) => row.id === point.id)) return rows;
          return [...rows, point];
        },
      );
      qc.invalidateQueries({ queryKey: ["task-knowledge-points", point.task_id] });
    },
  });
}

export function useDeleteKnowledgePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteKnowledgePoint(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-knowledge-points"] });
    },
  });
}
