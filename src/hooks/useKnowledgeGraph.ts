import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";

/** 工具箱里的学科包清单：哪些内置、哪些下载过、哪些还没下。 */
export function useKnowledgePacks(pluginId: string | null) {
  return useQuery({
    queryKey: ["knowledge-packs", pluginId],
    queryFn: () => api.listPluginKnowledgePacks(pluginId as string),
    enabled: Boolean(pluginId),
  });
}

/** 某个学科的知识点。可以按学段筛，也可以搜关键词。 */
export function useKnowledgePoints(
  pluginId: string | null,
  subject: string | null,
  stage?: string,
  query?: string,
) {
  return useQuery({
    queryKey: ["knowledge-points", pluginId, subject, stage ?? "", query ?? ""],
    queryFn: () =>
      api.listPluginKnowledgePoints(
        pluginId as string,
        subject as string,
        stage ?? null,
        query ?? null,
      ),
    enabled: Boolean(pluginId && subject),
  });
}

/** 某个知识点的先修：直接先修 + 沿硬先修回溯出的深层前置。 */
export function usePrerequisites(
  pluginId: string | null,
  subject: string | null,
  topicId: string | null,
) {
  return useQuery({
    queryKey: ["knowledge-prerequisites", pluginId, subject, topicId],
    queryFn: () =>
      api.listPluginPrerequisites(
        pluginId as string,
        subject as string,
        topicId as string,
      ),
    enabled: Boolean(pluginId && subject && topicId),
    // 换中心时先留着上一个的图，详情面板不闪一下。
    placeholderData: (previous) => previous,
  });
}

/**
 * 某个任务的排期建议：先修还没学完就排了后面的地方。
 *
 * 后端是纯读的，算不出来就返回空列表，不会报错。
 */
export function useTaskPrerequisiteConflicts(
  pluginId: string | null,
  taskId: number | null,
) {
  return useQuery({
    queryKey: ["task-prerequisite-conflicts", pluginId, taskId],
    queryFn: () =>
      api.listTaskPrerequisiteConflicts(pluginId as string, taskId as number),
    enabled: Boolean(pluginId && taskId),
  });
}

/**
 * 某个知识点上错过哪些题。
 *
 * 后端是纯读的，图谱读不到时只少一个名字，错题照样返回。
 */
export function useTopicMistakes(
  pluginId: string | null,
  subject: string | null,
  topicId: string | null,
) {
  return useQuery({
    queryKey: ["topic-mistakes", pluginId, subject, topicId],
    queryFn: () =>
      api.listTopicMistakes(
        pluginId as string,
        subject as string,
        topicId as string,
      ),
    enabled: Boolean(pluginId && subject && topicId),
  });
}

/** 下载某个学科的知识点包。下完把清单和列表都刷新一遍。 */
export function useKnowledgePackDownload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      pluginId,
      subject,
    }: {
      pluginId: string;
      subject: string;
    }) => api.downloadPluginKnowledgePack(pluginId, subject),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["knowledge-packs", vars.pluginId] });
      void qc.invalidateQueries({ queryKey: ["knowledge-points", vars.pluginId] });
    },
  });
}
