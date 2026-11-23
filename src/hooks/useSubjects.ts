import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import type { UpsertSubjectPayload } from "../types";

/**
 * 科目字典。折算口径、成绩表单、设置页都从这里读科目集合。
 *
 * 给了赛道 id 就只看这条赛道下的科目。
 */
export function useSubjects(trackId?: number | null) {
  const query = useQuery({
    queryKey: ["subjects", trackId ?? null],
    queryFn: () => api.listSubjects(trackId ?? null),
  });
  // 后端永远返回数组，这里再兜一层：拿到 null 也不让下游崩。
  return { ...query, data: query.data ?? [] };
}

/** 科目的增删改。 */
export function useSubjectMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["subjects"] });
  const upsert = useMutation({
    mutationFn: (payload: UpsertSubjectPayload) => api.upsertSubject(payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.removeSubject(id),
    onSuccess: invalidate,
  });
  return { upsert, remove };
}
