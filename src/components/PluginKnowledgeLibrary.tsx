import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  useKnowledgePackDownload,
  useKnowledgePacks,
  useKnowledgePoints,
  usePrerequisites,
} from "../hooks/useKnowledgeGraph";
import {
  KNOWLEDGE_GRAPH_ATTRIBUTION,
  KNOWLEDGE_GRAPH_DISCLAIMER,
} from "../lib/constants";
import { PrerequisiteGraph } from "./PrerequisiteGraph";
import type {
  KnowledgeDownloadProgress,
  KnowledgePackEntry,
  KnowledgeTopic,
  PrerequisiteNode,
  PrerequisiteResult,
} from "../types";

/** 后端下载进度事件的名称。 */
const KNOWLEDGE_DOWNLOAD_PROGRESS_EVENT = "knowledge-pack-download-progress";

/** 一页先出这么多条，剩下的点「更多」再放出来。 */
const PAGE_SIZE = 60;

/** 展开历史最多记这么多步，防止来回点同一个节点把栈撑爆。 */
const HISTORY_LIMIT = 50;

/** 学段筛选项。顺序按学制从小到大。 */
const STAGES = ["小学", "初中", "高中", "其他"];

function errorText(err: unknown): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  return "操作失败";
}

/** 先修强度：硬门槛是「不会就学不了」，软的是「会了有帮助」。 */
function strengthLabel(strength: string): string {
  return strength === "hard" ? "硬门槛" : "有帮助";
}

function strengthClass(strength: string): string {
  return strength === "hard"
    ? "bg-orange-500/15 text-orange-300"
    : "bg-white/10 text-ink-muted";
}

/** 学科包状态徽标。 */
function stateBadge(pack: KnowledgePackEntry) {
  if (pack.state === "builtin") {
    return (
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">
        已内置
      </span>
    );
  }
  if (pack.state === "downloaded") {
    return (
      <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300">
        已下载
      </span>
    );
  }
  return (
    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-ink-muted">
      需下载
    </span>
  );
}

/**
 * 知识图谱插件的浏览面板。
 *
 * 数学、物理随应用内置，不联网就能看；其余学科点下载时从上游仓库拉数据，
 * 落到插件目录缓存起来，之后切学科就是本地读。
 */
export function PluginKnowledgeLibrary({ pluginId }: { pluginId: string }) {
  const { data: packs = [], isLoading: packsLoading } = useKnowledgePacks(pluginId);
  const [subject, setSubject] = useState("");
  const [stage, setStage] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [topicId, setTopicId] = useState("");
  // 图上点节点会换中心，这里记住走过哪几个，方便退回上一个。
  const [history, setHistory] = useState<string[]>([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [progress, setProgress] = useState<KnowledgeDownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const download = useKnowledgePackDownload();

  // 默认选中第一个已经能用的学科，内置的排在前面。
  useEffect(() => {
    if (subject || packs.length === 0) return;
    const first = packs.find((pack) => pack.state !== "available") ?? packs[0];
    setSubject(first.subject);
  }, [packs, subject]);

  // 搜索词防抖：后端每次都要整包解析，敲一个字查一次太浪费。
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    void listen<KnowledgeDownloadProgress>(
      KNOWLEDGE_DOWNLOAD_PROGRESS_EVENT,
      (event) => {
        if (!event.payload?.file) return;
        setProgress(event.payload);
      },
    )
      .then((stopListen) => {
        if (cancelled) stopListen();
        else unlisten = stopListen;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const points = useKnowledgePoints(
    pluginId,
    subject || null,
    stage,
    debouncedQuery,
  );
  const prerequisites = usePrerequisites(pluginId, subject || null, topicId || null);

  const topics = useMemo(() => points.data ?? [], [points.data]);
  const selected = useMemo(
    () => prerequisites.data?.topic ?? null,
    [prerequisites.data],
  );

  const onDownload = async (pack: KnowledgePackEntry) => {
    setError(null);
    setNotice(null);
    setProgress(null);
    try {
      const result = await download.mutateAsync({
        pluginId,
        subject: pack.subject,
      });
      setNotice(`${result.name} 已下载，共 ${result.count} 个知识点。`);
      setSubject(pack.subject);
      setTopicId("");
      setLimit(PAGE_SIZE);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const onPickSubject = (next: string) => {
    setSubject(next);
    setTopicId("");
    setHistory([]);
    setLimit(PAGE_SIZE);
    setError(null);
    setNotice(null);
  };

  // 从列表里挑一个知识点：从头开始看。
  const focusTopic = (id: string) => {
    setTopicId(id);
    setHistory([id]);
  };

  // 图上点一个先修节点：以它为中心继续往下展开。
  const expandTopic = (id: string) => {
    if (!id || id === topicId) return;
    setTopicId(id);
    // 按访问顺序记，允许同一个知识点再次被展开。
    // 去重会让返回键退错地方：看完 A → B → 又点回 A，按去重算返回会停在 A 自己。
    setHistory((current) => [...current, id].slice(-HISTORY_LIMIT));
  };

  // 退回上一个看过的知识点。
  const goBack = () => {
    const next = history.slice(0, -1);
    const previous = next[next.length - 1];
    if (!previous) return;
    setHistory(next);
    setTopicId(previous);
  };

  if (packsLoading) {
    return <p className="mt-2 text-sm text-ink-muted">加载学科包…</p>;
  }

  const downloadingSubject = download.isPending
    ? (download.variables?.subject ?? "")
    : "";
  const progressPercent = progress?.total
    ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
    : null;

  return (
    <section className="mt-6">
      <h2 className="font-display text-base">知识图谱</h2>
      <p className="mt-1 text-xs text-ink-muted">
        数学、物理随应用内置，不联网也能看。其余学科按需下载。
      </p>

      <ul className="mt-3 flex flex-wrap gap-2">
        {packs.map((pack) => {
          const active = pack.subject === subject;
          const downloading = downloadingSubject === pack.subject;
          return (
            <li key={pack.subject}>
              <div
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 ${
                  active
                    ? "border-accent/60 bg-accent/10"
                    : "border-white/10 bg-surface-3"
                }`}
              >
                <button
                  type="button"
                  aria-label={`${pack.name} ${pack.count}`}
                  onClick={() => onPickSubject(pack.subject)}
                  disabled={pack.state === "available"}
                  className="text-sm text-ink transition hover:text-accent disabled:cursor-not-allowed disabled:text-ink-muted"
                >
                  {pack.name}
                  <span className="ml-1 text-xs text-ink-muted">{pack.count}</span>
                </button>
                {stateBadge(pack)}
                {pack.state === "available" ? (
                  <button
                    type="button"
                    aria-label={`下载 ${pack.name} 知识点`}
                    disabled={download.isPending}
                    onClick={() => void onDownload(pack)}
                    className="rounded-lg border border-white/10 px-2 py-0.5 text-[11px] text-ink-muted transition hover:text-ink disabled:opacity-40"
                  >
                    {downloading ? "下载中…" : "下载"}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {progressPercent !== null && download.isPending ? (
        <div className="mt-3">
          <p className="text-xs text-accent">
            正在下载 {progress?.file} · {progressPercent}%
          </p>
          <span className="mt-1 block h-1 w-full overflow-hidden rounded bg-white/10">
            <span
              className="block h-full bg-accent"
              style={{ width: `${progressPercent}%` }}
            />
          </span>
          <p className="mt-1 text-[11px] text-ink-muted">
            上游只发布全量文件，下载一次后切到别的学科就不用再下。
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 text-sm text-emerald-300" role="status">
          {notice}
        </p>
      ) : null}

      {subject ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="search"
              aria-label="搜索知识点"
              placeholder="搜索知识点、章节或领域"
              className="w-56 rounded-lg border border-white/10 bg-surface-3 px-3 py-1.5 text-sm text-ink outline-none focus:border-accent/60"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE_SIZE);
              }}
            />
            <span className="text-xs text-ink-muted">
              {topics.length > 0 ? `筛出 ${topics.length} 个知识点` : ""}
            </span>
          </div>

          <div role="tablist" aria-label="学段" className="mt-3 flex flex-wrap gap-1">
            <StageTab
              label="全部"
              selected={stage === ""}
              onSelect={() => {
                setStage("");
                setLimit(PAGE_SIZE);
              }}
            />
            {STAGES.map((item) => (
              <StageTab
                key={item}
                label={item}
                selected={stage === item}
                onSelect={() => {
                  setStage(item);
                  setLimit(PAGE_SIZE);
                }}
              />
            ))}
          </div>

          {points.isLoading ? (
            <p className="mt-4 text-sm text-ink-muted">加载知识点…</p>
          ) : topics.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              没有匹配的知识点。
            </p>
          ) : (
            <ul className="mt-3 max-h-[24rem] space-y-1.5 overflow-auto pr-1">
              {topics.slice(0, limit).map((topic) => (
                <li key={topic.id}>
                  <TopicRow
                    topic={topic}
                    active={topic.id === topicId}
                    onSelect={() => focusTopic(topic.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          {topics.length > limit ? (
            <button
              type="button"
              className="mt-2 rounded-lg px-2 py-1 text-xs text-accent hover:bg-accent/10"
              onClick={() => setLimit((current) => current + PAGE_SIZE)}
            >
              更多（还有 {topics.length - limit} 个）
            </button>
          ) : null}
        </>
      ) : null}

      {selected ? (
        <TopicDetail
          result={prerequisites.data ?? null}
          loading={prerequisites.isLoading}
          onSelectTopic={expandTopic}
          onBack={goBack}
          canGoBack={history.length > 1}
        />
      ) : null}

      <p className="mt-6 text-[11px] leading-relaxed text-ink-muted/80">
        {KNOWLEDGE_GRAPH_ATTRIBUTION}
        <br />
        {KNOWLEDGE_GRAPH_DISCLAIMER}
      </p>
    </section>
  );
}

function StageTab({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`rounded-lg px-3 py-1.5 text-sm ${
        selected
          ? "bg-accent text-white"
          : "text-ink-muted hover:bg-white/5 hover:text-ink"
      }`}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

function TopicRow({
  topic,
  active,
  onSelect,
}: {
  topic: KnowledgeTopic;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border px-3 py-2 text-left transition ${
        active
          ? "border-accent/60 bg-accent/10"
          : "border-white/10 bg-surface-3 hover:border-white/20"
      }`}
    >
      <span className="block truncate text-sm text-ink">{topic.name}</span>
      <span className="mt-0.5 block truncate text-xs text-ink-muted">
        {topic.stage ? `${topic.stage} · ` : ""}
        {topic.chapter || topic.domain || "—"}
      </span>
    </button>
  );
}

function TopicDetail({
  result,
  loading,
  onSelectTopic,
  onBack,
  canGoBack,
}: {
  result: PrerequisiteResult | null;
  loading: boolean;
  onSelectTopic?: (topicId: string) => void;
  onBack?: () => void;
  canGoBack?: boolean;
}) {
  const topic = result?.topic ?? null;
  const direct = result?.direct ?? [];
  const ancestors = result?.ancestors ?? [];
  if (!topic) return null;

  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-surface-3 p-4">
      {canGoBack ? (
        <button
          type="button"
          aria-label="返回上一个知识点"
          className="mb-2 text-xs text-accent-soft hover:underline"
          onClick={() => onBack?.()}
        >
          ← 返回上一个知识点
        </button>
      ) : null}
      <h3 className="font-display text-base text-ink">{topic.name}</h3>
      <p className="mt-1 text-xs text-ink-muted">
        {[
          topic.stage,
          topic.grade ? `${topic.grade} 年级` : "",
          topic.semester,
          topic.domain,
          topic.chapter,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {topic.description ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          {topic.description}
        </p>
      ) : null}

      {topic.masteryCriteria.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-xs font-medium text-ink">掌握标准</h4>
          <ul className="mt-1.5 space-y-1 text-xs text-ink-muted">
            {topic.masteryCriteria.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true" className="text-accent">
                  ·
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {topic.diagnosticQuestion ? (
        <div className="mt-3 rounded-lg bg-white/5 p-3">
          <h4 className="text-xs font-medium text-ink">诊断题</h4>
          <p className="mt-1 text-xs text-ink-muted">
            {topic.diagnosticQuestion.question}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            答案：{topic.diagnosticQuestion.answer}
          </p>
        </div>
      ) : null}

      <div className="mt-4">
        <PrerequisiteGraph result={result} onSelectTopic={onSelectTopic} />
      </div>

      <div className="mt-4">
        <h4 className="text-xs font-medium text-ink">
          先修关系{loading ? "（加载中…）" : ""}
        </h4>
        {direct.length === 0 && ancestors.length === 0 && !loading ? (
          <p className="mt-1 text-xs text-ink-muted">
            没有记录先修关系，这个知识点可以直接学。
          </p>
        ) : null}

        {direct.length > 0 ? (
          <>
            <p className="mt-2 text-[11px] text-ink-muted">直接先修</p>
            <ul className="mt-1 space-y-1">
              {direct.map((node) => (
                <li key={node.topic.id}>
                  <PrerequisiteRow node={node} indent={0} />
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {ancestors.length > 0 ? (
          <>
            <p className="mt-3 text-[11px] text-ink-muted">
              深层前置（沿硬门槛回溯）
            </p>
            <ul className="mt-1 space-y-1">
              {ancestors.map((node) => (
                <li key={node.topic.id}>
                  <PrerequisiteRow node={node} indent={node.depth - 1} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      {topic.mathLinks.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-xs font-medium text-ink">关联的数学知识点</h4>
          <ul className="mt-1 space-y-1 text-xs text-ink-muted">
            {topic.mathLinks.map((link) => (
              <li key={link.id}>
                <span className="text-ink">{link.id}</span>
                {link.reason ? ` · ${link.reason}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PrerequisiteRow({
  node,
  indent,
}: {
  node: PrerequisiteNode;
  indent: number;
}) {
  return (
    <div
      className="rounded-lg bg-white/5 px-2.5 py-1.5"
      style={{ marginLeft: `${indent * 12}px` }}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink">{node.topic.name}</span>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] ${strengthClass(node.strength)}`}
        >
          {strengthLabel(node.strength)}
        </span>
      </span>
      {node.reason ? (
        <span className="mt-0.5 block text-[11px] text-ink-muted">
          {node.reason}
        </span>
      ) : null}
    </div>
  );
}