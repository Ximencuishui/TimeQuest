import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import type { CreateExamSessionPayload } from "../types";

export function useExamSessions() {
  return useQuery({
    queryKey: ["examSessions"],
    queryFn: () => api.listExamSessions(),
  });
}

export function useExamSessionMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["examSessions"] });
  };
  const create = useMutation({
    mutationFn: (payload: CreateExamSessionPayload) => api.createExamSession(payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteExamSession(id),
    onSuccess: invalidate,
  });
  return { create, remove };
}
