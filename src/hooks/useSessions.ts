import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import { resolveCelebration } from "../lib/celebration";
import { broadcastSessionUpdated } from "../lib/widgetWindow";
import type { CompleteSessionInput, RescheduleInput } from "../types";
import { useUiStore } from "../store/ui";
import { useCelebration } from "./useCelebration";

export function useSessionsByDate(date: string) {
  return useQuery({
    queryKey: ["sessions", date],
    queryFn: () => api.listSessionsByDate(date),
  });
}

export function useSessionsInRange(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ["sessions-range", start, end],
    queryFn: () => api.listSessionsInRange(start, end),
    enabled,
  });
}

export function useSessionsByTask(taskId: number | null) {
  return useQuery({
    queryKey: ["sessions-task", taskId],
    queryFn: () => api.listSessionsByTask(taskId!),
    enabled: taskId != null,
  });
}

export function useSessionMutations() {
  const qc = useQueryClient();
  const showAchievement = useUiStore((s) => s.showAchievement);
  const { celebrate } = useCelebration();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sessions"] });
    qc.invalidateQueries({ queryKey: ["sessions-range"] });
    qc.invalidateQueries({ queryKey: ["sessions-task"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["task"] });
    qc.invalidateQueries({ queryKey: ["task-progress"] });
    qc.invalidateQueries({ queryKey: ["task-knowledge-points"] });
    qc.invalidateQueries({ queryKey: ["user-stats"] });
    qc.invalidateQueries({ queryKey: ["achievements"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    broadcastSessionUpdated();
  };

  const create = useMutation({
    mutationFn: api.createSession,
    onSuccess: invalidate,
  });

  const complete = useMutation({
    mutationFn: (input: CompleteSessionInput) => api.completeSession(input),
    onSuccess: (res) => {
      invalidate();
      const milestone = resolveCelebration(res);
      if (milestone) celebrate(milestone.type, milestone);
      if (res.newAchievements?.length) {
        const id = res.newAchievements[0];
        const labels: Record<string, { title: string; description: string }> = {
          first_round: {
            title: "首轮完成",
            description: "完成了一轮主线任务，继续保持。",
          },
          comeback: {
            title: "逆风翻盘",
            description: "改期后高质量完成，计划仍在掌控中。",
          },
          balanced: {
            title: "均衡发展",
            description: "本周主线与副本都有推进。",
          },
          streak_5: {
            title: "持续在场",
            description: "连续 5 天完成学习排期。",
          },
        };
        showAchievement(labels[id] ?? { title: "成就解锁", description: id });
      }
    },
  });

  const reschedule = useMutation({
    mutationFn: (input: RescheduleInput) => api.rescheduleSession(input),
    onSuccess: invalidate,
  });

  return { create, complete, reschedule };
}
