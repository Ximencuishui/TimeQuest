import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";

export function useLogs(from: string, to: string) {
  return useQuery({
    queryKey: ["logs", from, to],
    queryFn: () => api.listLogs(from, to),
  });
}

export function useCreateLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createLog,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logs"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
