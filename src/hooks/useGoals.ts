import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import { migrateLegacyGoals } from "../lib/goals";
import type { UpsertGoalPayload } from "../types";

export const GOALS_QUERY_KEY = ["goals"] as const;

/** 目标列表。主目标排在最前，其余按日期从早到晚。 */
export function useGoals() {
  const query = useQuery({
    queryKey: GOALS_QUERY_KEY,
    queryFn: () => api.listGoals(),
  });
  // 后端永远返回数组，这里再兜一层：拿到 null 也不让下游崩。
  return { ...query, data: query.data ?? [] };
}

export function useGoalMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: GOALS_QUERY_KEY });
  };
  const upsert = useMutation({
    mutationFn: (payload: UpsertGoalPayload) => api.upsertGoal(payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.removeGoal(id),
    onSuccess: invalidate,
  });
  const setPrimary = useMutation({
    mutationFn: (id: number) => api.setPrimaryGoal(id),
    onSuccess: invalidate,
  });
  return { upsert, remove, setPrimary };
}

/**
 * 启动时把老版本 localStorage 里的目标搬进数据库。
 *
 * 只搬一次：搬完删掉旧 key 并打标记，重复启动不会再搬。
 * 悬浮窗不跑这段（它只读不写）。
 */
export function useGoalsMigration() {
  const qc = useQueryClient();
  useEffect(() => {
    void migrateLegacyGoals()
      .then(() => qc.invalidateQueries({ queryKey: GOALS_QUERY_KEY }))
      .catch((error: unknown) => {
        console.warn("goals migration failed", error);
      });
  }, [qc]);
}
