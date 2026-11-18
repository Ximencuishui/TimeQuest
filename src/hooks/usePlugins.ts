import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";

/** 工具箱的插件列表（内置仓库 + 已安装标记）。 */
export function usePlugins() {
  return useQuery({
    queryKey: ["plugins"],
    queryFn: () => api.listPlugins(),
  });
}

/** 下载 / 卸载插件。 */
export function usePluginMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["plugins"] });

  return {
    install: useMutation({
      mutationFn: (id: string) => api.installPlugin(id),
      onSuccess: invalidate,
    }),
    uninstall: useMutation({
      mutationFn: (id: string) => api.uninstallPlugin(id),
      onSuccess: invalidate,
    }),
  };
}

/** 某个插件的选项当前值。没装插件时传 null，不发请求。 */
export function usePluginOptions(pluginId: string | null) {
  return useQuery({
    queryKey: ["plugin-options", pluginId],
    queryFn: () => api.listPluginOptions(pluginId as string),
    enabled: Boolean(pluginId),
  });
}

/** 保存插件选项。 */
export function usePluginOptionMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      pluginId,
      key,
      value,
    }: {
      pluginId: string;
      key: string;
      value: string;
    }) => api.setPluginOption(pluginId, key, value),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["plugin-options", vars.pluginId] });
    },
  });
}

/** 教材源插件的教材清单。没装插件时传 null，不发请求。 */
export function usePluginTextbookCatalog(pluginId: string | null) {
  return useQuery({
    queryKey: ["plugin-textbook-catalog", pluginId],
    queryFn: () => api.listPluginTextbookCatalog(pluginId as string),
    enabled: Boolean(pluginId),
  });
}

/** 下载一本教材。只下用户点的那一本，分片的书由后端接成一个 PDF。 */
export function useTextbookDownloadMutation() {
  return useMutation({
    mutationFn: ({
      pluginId,
      path,
    }: {
      pluginId: string;
      path: string;
    }) => api.downloadPluginTextbook(pluginId, path),
  });
}