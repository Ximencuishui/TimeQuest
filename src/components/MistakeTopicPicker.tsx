import { useEffect, useMemo, useState } from "react";
import { useKnowledgePacks, useKnowledgePoints } from "../hooks/useKnowledgeGraph";
import { KNOWLEDGE_GRAPH_PLUGIN_ID } from "../lib/constants";
import type { KnowledgeTopic } from "../types";

/** 一页先出这么多条，剩下的点「更多」再放出来。 */
const PAGE_SIZE = 20;

/** 搜索词防抖的等待时间。后端每次都要整包解析，敲一个字查一次太浪费。 */
const SEARCH_DEBOUNCE_MS = 300;

/** 挂到一条错题上的图谱知识点。 */
export type MistakeTopic = {
  /** 上游知识点 id，比如 `cnm_001`。 */
  id: string;
  /** 知识点名字。 */
  name: string;
  /** 图谱学科代号，比如 `math`。 */
  subject: string;
  /** 学科中文名，比如「数学」。 */
  subjectName: string;
};

/**
 * 给错题挑一个知识图谱上的知识点。
 *
 * 挑中的考点带上游 id 一起入库，这样同一条错题在图谱那边也能查到：
 * 错题本记的是「我在哪儿翻车」，知识图谱给的是「这儿该先会什么」，
 * 两个面板说的是同一件事，不是两张各画各的地图。
 *
 * 没装图谱插件、或者一个学科包都没下载时，这里直接不出选项：
 * 不挂知识点照样能记错题，图谱不是前置条件。
 */
export function MistakeTopicPicker({
  value,
  onChange,
}: {
  /** 当前挂着的知识点。没挂就是 null。 */
  value: MistakeTopic | null;
  onChange: (next: MistakeTopic | null) => void;
}) {
  const { data: packsData, isLoading: packsLoading, isError: packsError } =
    useKnowledgePacks(KNOWLEDGE_GRAPH_PLUGIN_ID);
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  // 还没下载的学科包里没有数据，先滤掉，只留能直接用的。
  const usablePacks = useMemo(
    () => (packsData ?? []).filter((pack) => pack.state !== "available"),
    [packsData],
  );

  useEffect(() => {
    if (subject || usablePacks.length === 0) return;
    setSubject(usablePacks[0].subject);
  }, [usablePacks, subject]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedQuery(query.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [query]);

  // 只在展开时才拉知识点：一个学科包有八百多个点，后端每次都要整包解析。
  // 用户不展开就没必要付这个钱。
  const points = useKnowledgePoints(
    KNOWLEDGE_GRAPH_PLUGIN_ID,
    open ? subject || null : null,
    "",
    debouncedQuery,
  );
  const topics = useMemo(() => points.data ?? [], [points.data]);
  const pack = useMemo(
    () => usablePacks.find((item) => item.subject === subject) ?? null,
    [usablePacks, subject],
  );

  const onPick = (topic: KnowledgeTopic) => {
    if (!pack) return;
    onChange({
      id: topic.id,
      name: topic.name,
      subject: pack.subject,
      subjectName: pack.name,
    });
    setOpen(false);
    setQuery("");
    setLimit(PAGE_SIZE);
  };

  if (value) {
    return (
      <div className="mt-3">
        <span className="text-sm">关联知识点</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span
            data-testid="mistake-topic-chip"
            className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs text-sky-300"
          >
            📘 {value.name}
            <span className="ml-1 text-ink-muted">{value.subjectName}</span>
          </span>
          <button
            type="button"
            className="text-xs text-ink-muted transition hover:text-ink"
            onClick={() => onChange(null)}
          >
            移除
          </button>
        </div>
      </div>
    );
  }

  if (packsLoading) {
    return <p className="mt-3 text-xs text-ink-muted">加载学科包…</p>;
  }

  if (packsError || usablePacks.length === 0) {
    return (
      <p className="mt-3 text-xs text-ink-muted">
        没有可用的知识图谱学科包。不关联知识点也能记，关联了才能在知识图谱里看到这条错题。
      </p>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">关联知识点（可选）</span>
        <button
          type="button"
          data-testid="mistake-topic-open"
          className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-ink-muted transition hover:border-accent/60 hover:text-ink"
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "收起" : "从知识图谱挑一个"}
        </button>
      </div>

      {open ? (
        <div className="mt-2 rounded-xl border border-white/10 bg-surface-3 p-2">
          <ul className="flex flex-wrap gap-1.5">
            {usablePacks.map((item) => {
              const active = item.subject === subject;
              return (
                <li key={item.subject}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setSubject(item.subject);
                      setLimit(PAGE_SIZE);
                    }}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      active
                        ? "border-accent/60 bg-accent/10 text-accent"
                        : "border-white/10 text-ink-muted hover:text-ink"
                    }`}
                  >
                    {item.name}
                    <span className="ml-1 text-[11px] text-ink-muted">
                      {item.count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <input
            type="search"
            aria-label="搜索图谱知识点"
            placeholder="搜索知识点、章节或领域"
            className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-accent/60"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE_SIZE);
            }}
          />

          {points.isLoading ? (
            <p className="mt-2 text-xs text-ink-muted">加载知识点…</p>
          ) : topics.length === 0 ? (
            <p className="mt-2 text-xs text-ink-muted">没有匹配的知识点。</p>
          ) : (
            <ul className="mt-2 max-h-56 space-y-1 overflow-auto">
              {topics.slice(0, limit).map((topic) => (
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
                    aria-label={`挂到知识点 ${topic.name}`}
                    onClick={() => onPick(topic)}
                    className="shrink-0 rounded-lg border border-white/10 px-2 py-0.5 text-[11px] text-sky-300 transition hover:border-accent/60"
                  >
                    挂上
                  </button>
                </li>
              ))}
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
      ) : null}
    </div>
  );
}
