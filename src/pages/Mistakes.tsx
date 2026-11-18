import { useMemo, useState } from "react";
import { useMistakeMutations, useMistakes } from "../hooks/useMistakes";
import { SUBJECTS } from "../lib/constants";
import {
  MISTAKE_FILTERS,
  MISTAKE_REASONS,
  filterMistakes,
  normalizeReason,
  normalizeSubject,
  reasonCounts,
  summarizeMistakes,
  type MistakeFilter,
} from "../lib/mistakes";
import type { Mistake } from "../types";

function MistakeCard({
  mistake,
  onToggleMastered,
  onDelete,
}: {
  mistake: Mistake;
  onToggleMastered: (m: Mistake) => void;
  onDelete: (m: Mistake) => void;
}) {
  const mastered = mistake.is_mastered === 1;
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
  const { create, update, remove } = useMistakeMutations();

  const [subject, setSubject] = useState<string>("物理");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState<string>(MISTAKE_REASONS[0]);
  const [correctNote, setCorrectNote] = useState("");
  const [filter, setFilter] = useState<MistakeFilter>("all");
  const [error, setError] = useState("");

  const visible = useMemo(
    () => filterMistakes(mistakes, filter),
    [mistakes, filter],
  );
  const summary = useMemo(() => summarizeMistakes(mistakes), [mistakes]);
  const topReason = useMemo(() => reasonCounts(mistakes)[0], [mistakes]);
  const titleMissing = title.trim() === "";
  const summaryLine =
    `共 ${summary.total} 条 · 已订正 ${summary.mastered} 条 · 待订正 ${summary.pending} 条` +
    (topReason ? ` · 错得最多：${topReason.reason} ×${topReason.count}` : "");

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
        reason: normalizeReason(reason),
        correctNote: correctNote.trim(),
      });
      setTitle("");
      setCorrectNote("");
    } catch (e) {
      setError(String(e));
    }
  };

  const onToggleMastered = (m: Mistake) => {
    update.mutate({
      id: m.id,
      payload: { isMastered: m.is_mastered === 1 ? 0 : 1 },
    });
  };

  const onDelete = (m: Mistake) => {
    if (window.confirm(`确认删除「${m.title}」？`)) {
      remove.mutate(m.id);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-2xl">错题本</h1>
        <p className="mt-1 text-sm text-ink-muted">
          做错的题记一条，订正完打个勾。下次复习先看没订正的。
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
              {SUBJECTS.map((s) => (
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
              {MISTAKE_REASONS.map((r) => (
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
