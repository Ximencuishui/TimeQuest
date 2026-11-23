import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  MistakeTopicPicker,
  type MistakeTopic,
} from "../components/MistakeTopicPicker";
import { useMistakeMutations, useMistakes } from "../hooks/useMistakes";
import { useMistakeReasons } from "../hooks/useMistakeReasons";
import { usePlugins } from "../hooks/usePlugins";
import { useActiveTrack } from "../hooks/useTracks";
import { useSubjects } from "../hooks/useSubjects";
import { KNOWLEDGE_GRAPH_PLUGIN_ID } from "../lib/constants";
import { resolveSubjects } from "../lib/content";
import {
  MISTAKE_FILTERS,
  filterMistakes,
  normalizeReason,
  normalizeSubject,
  reasonCounts,
  suggestsPrerequisites,
  summarizeMistakes,
  topicCount,
  type MistakeFilter,
} from "../lib/mistakes";
import type { Mistake } from "../types";

/** 知识图谱里某个知识点的深链。 */
function graphTopicHref(mistake: Mistake): string {
  const params = new URLSearchParams();
  if (mistake.graph_subject) params.set("subject", mistake.graph_subject);
  if (mistake.graph_topic_id) params.set("topic", mistake.graph_topic_id);
  return `/toolbox/plugins/${KNOWLEDGE_GRAPH_PLUGIN_ID}?${params.toString()}`;
}

function MistakeCard({
  mistake,
  onToggleMastered,
  onDelete,
  onOpenTopic,
  graphInstalled,
}: {
  mistake: Mistake;
  onToggleMastered: (m: Mistake) => void;
  onDelete: (m: Mistake) => void;
  onOpenTopic: (m: Mistake) => void;
  /** 知识图谱插件装了没有。没装就不给链接，免得点进去是死路。 */
  graphInstalled: boolean;
}) {
  const mastered = mistake.is_mastered === 1;
  const hasTopic = Boolean(mistake.graph_topic_id);
  const topicLabel = mistake.graph_topic_name ?? mistake.graph_topic_id ?? "";

  return (
    <article
      className="rounded-2xl border border-white/5 bg-surface-2/80 p-4"
      data-testid="mistake-card"
      data-mastered={mastered ? "true" : "false"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-ink-muted">
              {mistake.subject}
            </span>
            <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-orange-200">
              {mistake.reason}
            </span>
            {hasTopic ? (
              graphInstalled ? (
                <button
                  type="button"
                  data-testid="mistake-topic-link"
                  onClick={() => onOpenTopic(mistake)}
                  className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-300 transition hover:bg-sky-500/25"
                  title="在知识图谱里看这个知识点"
                >
                  📘 {topicLabel}
                </button>
              ) : (
                <span
                  data-testid="mistake-topic-tag"
                  className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-300"
                  title="装了知识图谱插件后，这个知识点就能点进去看"
                >
                  📘 {topicLabel}
                </span>
              )
            ) : null}
            {mastered ? (
              <span className="text-emerald-300">已订正</span>
            ) : (
              <span className="text-ink-muted">待订正</span>
            )}
          </div>
          <h2 className="mt-2 font-display text-base">{mistake.title}</h2>
          {mistake.correct_note ? (
            <p className="mt-1 text-sm text-ink-muted">
              正确思路：{mistake.correct_note}
            </p>
          ) : null}
          {hasTopic && suggestsPrerequisites(mistake.reason) ? (
            <p className="mt-1 text-[11px] text-ink-muted">
              这类错因多半是前面没学扎实，点上面的知识点看看它的前置关系。
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-3 text-sm">
          <button
            type="button"
            className="text-ink-muted hover:text-ink"
            onClick={() => onToggleMastered(mistake)}
          >
            {mastered ? "取消订正" : "标记已订正"}
          </button>
          <button
            type="button"
            className="text-ink-muted hover:text-ink"
            onClick={() => onDelete(mistake)}
          >
            删除
          </button>
        </div>
      </div>
    </article>
  );
}

export function Mistakes() {
  const { data: mistakes = [], isLoading, isError } = useMistakes();
  const { data: plugins = [] } = usePlugins();
  const { create, update, remove } = useMistakeMutations();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const reasons = useMistakeReasons();

  // 科目与错因都跟着赛道走：赛道包 / 赛道配置能换掉内置的那套。
  const { trackId } = useActiveTrack();
  const { data: trackSubjects = [] } = useSubjects(trackId);
  const subjectOptions = useMemo(
    () => resolveSubjects(trackSubjects),
    [trackSubjects],
  );

  const [subject, setSubject] = useState<string>("物理");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState<string>(reasons[0] ?? "其他");
  const [correctNote, setCorrectNote] = useState("");
  const [topic, setTopic] = useState<MistakeTopic | null>(null);
  const [filter, setFilter] = useState<MistakeFilter>("all");
  const [error, setError] = useState("");
  /** 列表里的操作（订正、删除）失败了要说一声，不然用户以为改成了。 */
  const [actionError, setActionError] = useState("");

  // 赛道换了、配置改了，选中的值要跟着回到合法范围里。
  useEffect(() => {
    setSubject((current) =>
      subjectOptions.includes(current) ? current : subjectOptions[0] ?? "其他",
    );
  }, [subjectOptions]);
  useEffect(() => {
    setReason((current) =>
      reasons.includes(current) ? current : reasons[0] ?? "其他",
    );
  }, [reasons]);

  const graphInstalled = plugins.some(
    (plugin) => plugin.id === KNOWLEDGE_GRAPH_PLUGIN_ID && plugin.installed,
  );

  // 从知识图谱点「记一条错题」跳过来时，直接把知识点带进表单。
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const topicId = searchParams.get("graphTopic")?.trim();
    if (!topicId) return;
    deepLinkApplied.current = true;
    const subjectName = searchParams.get("graphSubjectName")?.trim() ?? "";
    const topicName = searchParams.get("graphTopicName")?.trim() ?? topicId;
    if (subjectName) setSubject(subjectName);
    setTopic({
      id: topicId,
      name: topicName,
      subject: searchParams.get("graphSubject")?.trim() ?? "",
      subjectName,
    });
  }, [searchParams]);

  const visible = useMemo(
    () => filterMistakes(mistakes, filter),
    [mistakes, filter],
  );
  const summary = useMemo(() => summarizeMistakes(mistakes), [mistakes]);
  const topics = useMemo(() => topicCount(mistakes), [mistakes]);
  const topReason = useMemo(() => reasonCounts(mistakes, reasons)[0], [mistakes, reasons]);
  const titleMissing = title.trim() === "";
  const summaryLine =
    `共 ${summary.total} 条 · 已订正 ${summary.mastered} 条 · 待订正 ${summary.pending} 条` +
    (topics > 0 ? ` · 涉及 ${topics} 个知识点` : "") +
    (topReason ? ` · 错得最多：${topReason.reason} ×${topReason.count}` : "");

  const onTopicChange = (next: MistakeTopic | null) => {
    setTopic(next);
    // 挑了知识点就跟着它的学科走，科目不用再手选一遍。
    if (next?.subjectName) setSubject(next.subjectName);
  };

  const onSubmit = async () => {
    if (titleMissing) {
      setError("写一句题目简述，别人才看得懂你记的是哪道题。");
      return;
    }
    setError("");
    try {
      await create.mutateAsync({
        subject: normalizeSubject(subject),
        title: title.trim(),
        reason: normalizeReason(reason, reasons),
        correctNote: correctNote.trim(),
        graphTopicId: topic?.id ?? null,
        graphSubject: topic?.subject ?? null,
        graphTopicName: topic?.name ?? null,
      });
      setTitle("");
      setCorrectNote("");
      setTopic(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const onToggleMastered = (m: Mistake) => {
    setActionError("");
    update.mutate(
      { id: m.id, payload: { isMastered: m.is_mastered === 1 ? 0 : 1 } },
      { onError: (e) => setActionError(`没能更新订正状态：${String(e)}`) },
    );
  };

  const onDelete = (m: Mistake) => {
    if (window.confirm(`确认删除「${m.title}」？`)) {
      setActionError("");
      remove.mutate(m.id, {
        onError: (e) => setActionError(`没能删除这条错题：${String(e)}`),
      });
    }
  };

  const onOpenTopic = (m: Mistake) => {
    navigate(graphTopicHref(m));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-2xl">错题本</h1>
        <p className="mt-1 text-sm text-ink-muted">
          做错的题记一条，订正完打个勾。挂上知识点之后，在知识图谱里就能看到你在这儿错了几次。
        </p>
      </div>

      <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor="mistake-subject" className="block text-sm">
            科目
            <select
              id="mistake-subject"
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            >
              {subjectOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="mistake-reason" className="block text-sm">
            错因
            <select
              id="mistake-reason"
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            >
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label htmlFor="mistake-title" className="mt-3 block text-sm">
          题目简述
          <input
            id="mistake-title"
            className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
            placeholder="如：牛顿第二定律应用"
            value={title}
            onChange={(event) => {
              setError("");
              setTitle(event.target.value);
            }}
          />
        </label>
        <label htmlFor="mistake-note" className="mt-3 block text-sm">
          正确思路（可留空）
          <textarea
            id="mistake-note"
            className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
            rows={2}
            placeholder="写下这次想明白的关键一步"
            value={correctNote}
            onChange={(event) => setCorrectNote(event.target.value)}
          />
        </label>
        <MistakeTopicPicker value={topic} onChange={onTopicChange} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={create.isPending}
            onClick={() => {
              void onSubmit();
            }}
          >
            记下来
          </button>
          {error ? <p className="text-sm text-amber-300">{error}</p> : null}
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">{summaryLine}</p>
        <div className="flex gap-2">
          {MISTAKE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm ${
                filter === f.key
                  ? "bg-accent/15 text-accent-soft"
                  : "text-ink-muted hover:bg-white/5 hover:text-ink"
              }`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {actionError ? (
        <p className="text-sm text-amber-300" data-testid="mistake-action-error">
          {actionError}
        </p>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-ink-muted">加载中…</p>
      ) : isError ? (
        <p className="text-sm text-ink-muted">错题本暂时读不出来。</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {mistakes.length === 0
            ? "还没有错题。做错的题记下来，复习时一眼看到。"
            : "这个筛选下没有错题。"}
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((m) => (
            <MistakeCard
              key={m.id}
              mistake={m}
              onToggleMastered={onToggleMastered}
              onDelete={onDelete}
              onOpenTopic={onOpenTopic}
              graphInstalled={graphInstalled}
            />
          ))}
        </div>
      )}
    </div>
  );
}
