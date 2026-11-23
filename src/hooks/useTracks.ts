import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import type { UpsertTrackPayload } from "../types";

/**
 * 赛道列表。
 *
 * 「高考」只是其中一条，换赛道就是换一套科目 + 一套目标分。
 */
export function useTracks() {
  const query = useQuery({
    queryKey: ["tracks"],
    queryFn: () => api.listTracks(),
  });
  // 后端永远返回数组，这里再兜一层：拿到 null 也不让下游崩。
  return { ...query, data: query.data ?? [] };
}

/** 当前主赛道：标了 isPrimary 的那条；没有就取第一条。 */
export function useActiveTrack() {
  const query = useTracks();
  const track = query.data.find((item) => item.isPrimary) ?? query.data[0] ?? null;
  return { ...query, track, trackId: track?.id ?? null };
}

/** 赛道的增删改。 */
export function useTrackMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tracks"] });
  const upsert = useMutation({
    mutationFn: (payload: UpsertTrackPayload) => api.upsertTrack(payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.removeTrack(id),
    onSuccess: invalidate,
  });
  return { upsert, remove };
}
