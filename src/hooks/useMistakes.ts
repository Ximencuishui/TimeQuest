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
