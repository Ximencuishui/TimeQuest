import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import { matchTextbook, outlinePointsBySection, outlineSectionNames } from "../lib/sectionCatalog";
import { broadcastSessionUpdated } from "../lib/widgetWindow";
import type { GenerateTasksFromOutlineInput, Task, TaskKnowledgePoint } from "../types";

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
  const advanceRound = useMutation({
    mutationFn: (id: number) => api.advanceRound(id),
    onSuccess: invalidate,
  });
  const generateFromOutline = useMutation({
    mutationFn: (input: GenerateTasksFromOutlineInput) =>
      api.generateTasksFromOutline(input),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["sessions-task"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      broadcastSessionUpdated();
    },
  });

  return { create, update, archive, advanceRound, generateFromOutline };
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
    mutationFn: (input: { taskId: number; sectionName: string; name: string }) =>
      api.addCustomKnowledgePoint(input.taskId, input.sectionName, input.name),
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
