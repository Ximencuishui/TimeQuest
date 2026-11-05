import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";

export function useNotes() {
  return useQuery({
    queryKey: ["notes"],
    queryFn: () => api.listNotes(),
  });
}

export function useNoteMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["notes"] });

  return {
    create: useMutation({
      mutationFn: ({ content, color }: { content: string; color: string }) =>
        api.createNote(content, color),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        payload,
      }: {
        id: number;
        payload: { content?: string; color?: string; pinned?: boolean };
      }) => api.updateNote(id, payload),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => api.deleteNote(id),
      onSuccess: invalidate,
    }),
  };
}
