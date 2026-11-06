import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import { broadcastSessionUpdated } from "../lib/widgetWindow";
import type { GenerateTasksFromOutlineInput, Task } from "../types";

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
