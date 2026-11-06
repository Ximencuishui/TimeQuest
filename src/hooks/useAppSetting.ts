import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";

/** Write one `app_settings` row and refresh its query. */
export function useSetSetting(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: string) => api.setSetting(key, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appSetting", key] });
    },
  });
}

/** Read one `app_settings` row. Missing keys resolve to `null`. */
export function useAppSetting(key: string) {
  const query = useQuery({
    queryKey: ["appSetting", key],
    queryFn: () => api.getSetting(key),
  });
  const setSetting = useSetSetting(key);
  return { ...query, setSetting };
}
