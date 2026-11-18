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
      mutationFn: ({
        content,
        color,
        noteDate,
      }: {
        content: string;
        color: string;
        /** 绑定的日期（YYYY-MM-DD）；不绑就传 null。 */
        noteDate?: string | null;
      }) => api.createNote(content, color, noteDate ?? null),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        payload,
      }: {
        id: number;
        payload: {
          content?: string;
          color?: string;
          pinned?: boolean;
          /** 空串 = 取消绑定日期。 */
          noteDate?: string;
        };
      }) => api.updateNote(id, payload),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => api.deleteNote(id),
      onSuccess: invalidate,
    }),
  };
}
