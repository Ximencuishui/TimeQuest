import { useQuery } from "@tanstack/react-query";
import { api } from "../api/tauri";

/**
 * 科目字典。折算口径、成绩表单都从这里读科目集合。
 */
export function useSubjects() {
  const query = useQuery({
    queryKey: ["subjects"],
    queryFn: () => api.listSubjects(),
  });
  // 后端永远返回数组，这里再兜一层：拿到 null 也不让下游崩。
  return { ...query, data: query.data ?? [] };
}