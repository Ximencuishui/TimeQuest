import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "../api/tauri";
import {
  usePluginTextbookCatalog,
  useTextbookDownloadMutation,
} from "../hooks/usePlugins";
import type {
  CatalogTextbook,
  TextbookDownloadProgress,
  TextbookOutline,
} from "../types";
import { TextbookImportWizard } from "./TextbookImportWizard";

/** 后端下载进度事件的名称。 */
const TEXTBOOK_DOWNLOAD_PROGRESS_EVENT = "textbook-download-progress";

/** 一页先出这么多本，剩下的点「更多」再放出来。 */
const PAGE_SIZE = 60;

function errorText(err: unknown): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  return "操作失败";
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "大小未知";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 教材版本：清单里有就取版本，没有就算通用版。 */
function bookVersion(book: CatalogTextbook): string {
  return book.edition?.trim() || "通用版";
}

/**
 * 教材在教材库里的册次。
 *
 * 用完整书名而不是年级：同一个年级有上册下册，光看年级会撞键。
 */
function bookVolume(book: CatalogTextbook): string {
  return book.title.trim() || book.path;
}

/** 新建任务时的默认名字。 */
function defaultTaskName(book: CatalogTextbook): string {
  return `${book.subject} · ${book.grade?.trim() || book.title}`;
}

type ImportedBook = {
  book: CatalogTextbook;
  outline: TextbookOutline;
};

/**
 * 教材源插件的教材库。
 *
 * 清单是插件自带的一份快照，用户挑中哪本才去下载哪本；
 * 下完立刻解析 PDF 目录，解析出来的章节可以直接拿去生成任务。
 */
export function PluginTextbookLibrary({ pluginId }: { pluginId: string }) {
  const { data: catalog, isLoading } = usePluginTextbookCatalog(pluginId);
  const download = useTextbookDownloadMutation();
  const [stage, setStage] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [progress, setProgress] = useState<TextbookDownloadProgress | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedBook | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    void listen<TextbookDownloadProgress>(
      TEXTBOOK_DOWNLOAD_PROGRESS_EVENT,
      (event) => {
        if (!event.payload?.path) return;
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

  const books = useMemo(() => catalog?.textbooks ?? [], [catalog]);

  const subjects = useMemo(() => {
    const names = new Set<string>();
    for (const book of books) {
      if (stage && book.stageKey !== stage) continue;
      if (book.subject) names.add(book.subject);
    }
    return [...names].sort((left, right) => left.localeCompare(right, "zh"));
  }, [books, stage]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books.filter((book) => {
      if (stage && book.stageKey !== stage) return false;
      if (subject && book.subject !== subject) return false;
      if (!q) return true;
      return (
        book.title.toLowerCase().includes(q) ||
        book.subject.toLowerCase().includes(q) ||
        (book.edition ?? "").toLowerCase().includes(q) ||
        (book.grade ?? "").toLowerCase().includes(q)
      );
    });
  }, [books, query, stage, subject]);

  const onDownload = async (book: CatalogTextbook) => {
    setError(null);
    setNotice(null);
    setImported(null);
    setProgress(null);
    try {
      const file = await download.mutateAsync({ pluginId, path: book.path });
      setImporting(book.path);
      const result = await api.importTextbookPdf(
        file.file,
        book.subject,
        bookVersion(book),
        bookVolume(book),
      );
      setImported({ book, outline: result.outline });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setImporting(null);
    }
  };

  if (isLoading) {
    return <p className="mt-2 text-sm text-ink-muted">加载教材清单…</p>;
  }

  if (!catalog) {
    return (
      <section className="mt-6">
        <h2 className="font-display text-base">教材库</h2>
        <p className="mt-2 text-sm text-ink-muted">读不到教材清单。</p>
      </section>
    );
  }

  const downloadingPath = download.isPending
    ? (download.variables?.path ?? "")
    : "";

  return (
    <section className="mt-6">
      <h2 className="font-display text-base">教材库</h2>
      <p className="mt-1 text-xs text-ink-muted">
        共 {catalog.count} 本，来自 {catalog.repo}（{catalog.generatedAt} 快照）。
        只下载你点的那一本。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="搜索教材"
          placeholder="搜索书名、版本或年级"
          className="w-56 rounded-lg border border-white/10 bg-surface-3 px-3 py-1.5 text-sm text-ink outline-none focus:border-accent/60"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(PAGE_SIZE);
          }}
        />
        <select
          aria-label="科目"
          className="rounded-lg border border-white/10 bg-surface-3 px-2 py-1.5 text-sm text-ink"
          value={subject}
          onChange={(event) => {
            setSubject(event.target.value);
            setLimit(PAGE_SIZE);
          }}
        >
          <option value="">全部科目</option>
          {subjects.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div role="tablist" aria-label="学段" className="mt-3 flex flex-wrap gap-1">
        <StageTab
          label="全部"
          selected={stage === ""}
          onSelect={() => {
            setStage("");
            setSubject("");
            setLimit(PAGE_SIZE);
          }}
        />
        {catalog.stages.map((item) => (
          <StageTab
            key={item.label}
            label={`${item.label} ${item.count}`}
            selected={stage === item.label}
            onSelect={() => {
              setStage(item.label);
              setSubject("");
              setLimit(PAGE_SIZE);
            }}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">没有匹配的教材。</p>
      ) : (
        <ul className="mt-3 max-h-[26rem] space-y-1.5 overflow-auto pr-1">
          {visible.slice(0, limit).map((book) => {
            const downloading = downloadingPath === book.path;
            const parsing = importing === book.path;
            const done = imported?.book.path === book.path;
            const bookProgress =
              downloading && progress?.path === book.path ? progress : null;
            const percent = bookProgress?.total
              ? Math.min(100, Math.round((bookProgress.downloaded / bookProgress.total) * 100))
              : null;
            return (
              <li
                key={book.path}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-surface-3 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{book.title}</span>
                  <span className="block text-xs text-ink-muted">
                    {book.subject}
                    {book.edition ? ` · ${book.edition}` : ""}
                    {book.grade ? ` · ${book.grade}` : ""} · {formatSize(book.size)}
                    {book.parts > 1 ? ` · ${book.parts} 个分片` : ""}
                  </span>
                </span>
                {bookProgress && percent !== null ? (
                  <span className="w-32">
                    <span className="block text-xs text-accent">
                      {percent}% · 第 {bookProgress.part}/{bookProgress.parts} 片
                      {bookProgress.attempt && bookProgress.attempt > 1
                        ? ` · 重试第 ${bookProgress.attempt} 次`
                        : ""}
                    </span>
                    <span className="mt-1 block h-1 w-full overflow-hidden rounded bg-white/10">
                      <span
                        className="block h-full bg-accent"
                        style={{ width: `${percent}%` }}
                      />
                    </span>
                  </span>
                ) : null}
                {done ? (
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-emerald-300">
                      已导入 {imported?.outline.chapters.length ?? 0} 章
                    </span>
                    <button
                      type="button"
                      aria-label={`勾选已掌握 ${imported.book.title}`}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white"
                      onClick={() => setWizardOpen(true)}
                    >
                      勾选已掌握
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`下载 ${book.title}`}
                    disabled={downloading || parsing}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink disabled:opacity-40"
                    onClick={() => void onDownload(book)}
                  >
                    {downloading
                      ? "下载中…"
                      : parsing
                        ? "解析目录…"
                        : "下载"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {visible.length > limit ? (
        <button
          type="button"
          className="mt-2 rounded-lg px-2 py-1 text-xs text-accent hover:bg-accent/10"
          onClick={() => setLimit((current) => current + PAGE_SIZE)}
        >
          更多（还有 {visible.length - limit} 本）
        </button>
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

      {imported && wizardOpen ? (
        <TextbookImportWizard
          preloaded={{
            outline: imported.outline,
            taskName: defaultTaskName(imported.book),
          }}
          onClose={() => setWizardOpen(false)}
          onCreated={(plannedCount, autoSchedule) => {
            setWizardOpen(false);
            setError(null);
            setNotice(
              autoSchedule
                ? `任务创建成功，已生成 ${plannedCount} 个排期`
                : "任务创建成功",
            );
          }}
        />
      ) : null}
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
        selected ? "bg-accent text-white" : "text-ink-muted hover:bg-white/5 hover:text-ink"
      }`}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}
