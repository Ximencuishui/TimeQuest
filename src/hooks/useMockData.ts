import { useQuery } from "@tanstack/react-query";
import { api } from "../api/tauri";

export function useHasMockData() {
  return useQuery({
    queryKey: ["hasMockData"],
    queryFn: () => api.hasMockData(),
  });
}
