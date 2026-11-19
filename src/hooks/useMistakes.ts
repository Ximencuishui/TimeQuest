import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import type { UpdateMistakePayload } from "../types";

export function useMistakes() {
  return useQuery({
    queryKey: ["mistakes"],
    queryFn: () => api.listMistakes(),
  });
}

export function useMistakeMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["mistakes"] });

  return {
    create: useMutation({
      mutationFn: (payload: {
        subject: string;
        title: string;
        reason: string;
        correctNote: string;
        /** 上游知识点 id（知识图谱）。不挂知识点就传 null。 */
        graphTopicId?: string | null;
        /** 图谱学科代号。 */
        graphSubject?: string | null;
        /** 知识点名字。 */
        graphTopicName?: string | null;
      }) => api.createMistake(payload),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        payload,
      }: {
        id: number;
        payload: UpdateMistakePayload;
      }) => api.updateMistake(id, payload),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => api.deleteMistake(id),
      onSuccess: invalidate,
    }),
  };
}
