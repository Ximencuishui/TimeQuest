import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import type { CreateExamRecordPayload } from "../types";

export function useExamRecords() {
  return useQuery({
    queryKey: ["examRecords"],
    queryFn: () => api.listExamRecords(),
  });
}

export function useExamRecordMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["examRecords"] });
  };
  const create = useMutation({
    mutationFn: (payload: CreateExamRecordPayload) => api.createExamRecord(payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteExamRecord(id),
    onSuccess: invalidate,
  });
  return { create, remove };
}
