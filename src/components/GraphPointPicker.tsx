import { useEffect, useMemo, useState } from "react";
import { useKnowledgePacks, useKnowledgePoints } from "../hooks/useKnowledgeGraph";
import { useAddCustomKnowledgePoint } from "../hooks/useTasks";
import { KNOWLEDGE_GRAPH_PLUGIN_ID } from "../lib/constants";
import type { KnowledgeTopic } from "../types";

/** 一页先出这么多条，剩下的点「更多」再放出来。 */
const PAGE_SIZE = 40;

/** 搜索词防抖的等待时间。后端每次都要整包解析，敲一个字查一次太浪费。 */
const SEARCH_DEBOUNCE_MS = 300;

function errorText(err: unknown): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  return "操作失败";
}

/**
 * 从知识图谱里挑考点加进任务。
 *
 * 只列已经能用的学科包（内置或已下载）。选中的考点会带上上游 id 一起入库，
 * 这样后面做排期检查时能顺着先修关系回溯。
 */
export function GraphPointPicker({
  taskId,
  taskSubject,
  takenTopicIds = [],
}: {
  taskId: number;
  /** 任务的科目，用来自动落到对应的学科包。 */
  taskSubject?: string | null;
  /** 已经加进这个任务的图谱考点 id，再点不重复加。 */
  takenTopicIds?: string[];
}) {
  const { data: packsData, isLoading: packsLoading } =
    useKnowledgePacks(KNOWLEDGE_GRAPH_PLUGIN_ID);
  const [subject, setSubject] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const add = useAddCustomKnowledgePoint();

  // 还没下载的学科包里没有数据，先滤掉，只留能直接用的。
  const usablePacks = useMemo(
    () => (packsData ?? []).filter((pack) => pack.state !== "available"),
    [packsData],
  );

  // 任务科目对得上就落在那个学科包上，对不上就落第一个能用的包。
  useEffect(() => {
    if (subject || usablePacks.length === 0) return;
    const wanted = (taskSubject ?? "").trim();
    const matched = usablePacks.find((pack) => pack.name.trim() === wanted);
    setSubject((matched ?? usablePacks[0]).subject);
  }, [usablePacks, subject, taskSubject]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedQuery(query.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [query]);

  const points = useKnowledgePoints(
    KNOWLEDGE_GRAPH_PLUGIN_ID,
    subject || null,
    "",
    debouncedQuery,
  );
  const topics = useMemo(() => points.data ?? [], [points.data]);
  const pack = useMemo(
    () => usablePacks.find((item) => item.subject === subject) ?? null,
    [usablePacks, subject],
  );
  const taken = useMemo(() => new Set(takenTopicIds), [takenTopicIds]);

  const onAdd = async (topic: KnowledgeTopic) => {
    if (!pack) return;
    setError(null);
    setNotice(null);
    try {
      await add.mutateAsync({
        taskId,
        sectionName: pack.name,
        name: topic.name,
        graphTopicId: topic.id,
        graphSubject: pack.subject,
      });
      setNotice(`已添加「${topic.name}」`);
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (packsLoading) {
    return <p className="text-xs text-ink-muted">加载学科包…</p>;
  }

  if (usablePacks.length === 0) {
    return (
      <p className="text-xs text-ink-muted">
        还没有可用的学科包。先去工具箱下载需要的学科，再回来挑考点。
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-surface-3 p-2">
      <ul className="flex flex-wrap gap-1.5">
        {usablePacks.map((item) => {
          const active = item.subject === subject;
          return (
            <li key={item.subject}>
              <button
                type="button"
                aria-label={`${item.name} ${item.count}`}
                aria-pressed={active}
                onClick={() => {
                  setSubject(item.subject);
                  setLimit(PAGE_SIZE);
                  setError(null);
                  setNotice(null);
                }}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  active
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-white/10 text-ink-muted hover:text-ink"
                }`}
              >
                {item.name}
                <span className="ml-1 text-[11px] text-ink-muted">{item.count}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <input
        type="search"
        aria-label="搜索图谱考点"
        placeholder="搜索知识点、章节或领域"
        className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-accent/60"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setLimit(PAGE_SIZE);
        }}
      />

      {error ? (
        <p className="mt-2 text-xs text-orange-400" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-2 text-xs text-emerald-300" role="status">
          {notice}
        </p>
      ) : null}

      {points.isLoading ? (
        <p className="mt-2 text-xs text-ink-muted">加载知识点…</p>
      ) : topics.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">没有匹配的知识点。</p>
      ) : (
        <ul className="mt-2 max-h-64 space-y-1 overflow-auto">
          {topics.slice(0, limit).map((topic) => {
            const already = taken.has(topic.id);
            return (
              <li
                key={topic.id}
                className="flex items-start justify-between gap-2 rounded-lg bg-white/5 px-2 py-1.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-zinc-200">
                    {topic.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                    {topic.stage ? `${topic.stage} · ` : ""}
                    {topic.chapter || topic.domain || "—"}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`添加考点 ${topic.name}`}
                  disabled={already || add.isPending}
                  onClick={() => void onAdd(topic)}
                  className="shrink-0 rounded-lg border border-white/10 px-2 py-0.5 text-[11px] text-orange-300 transition hover:border-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {already ? "已添加" : "添加"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {topics.length > limit ? (
        <button
          type="button"
          className="mt-2 px-2 py-1 text-[11px] text-accent hover:bg-accent/10"
          onClick={() => setLimit((current) => current + PAGE_SIZE)}
        >
          更多（还有 {topics.length - limit} 个）
        </button>
      ) : null}
    </div>
  );
}
