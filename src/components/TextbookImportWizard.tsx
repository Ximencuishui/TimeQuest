import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/tauri";
import { useTaskMutations } from "../hooks/useTasks";
import {
  defaultOutlineTaskName,
  groupTextbooksBySubject,
  knowledgePointPreview,
  sectionKey,
  sectionPlan,
  subjectAccent,
  volumeTrack,
  type AvailableTextbook,
} from "../lib/textbooks";
import { KNOWLEDGE_POINT_DISCLAIMER } from "../lib/constants";
import type { TextbookOutline } from "../types";
import { Modal } from "./Modal";

const STEPS = ["选择教材", "勾选已掌握", "确认生成"] as const;
const CONFIRM_DEBOUNCE_MS = 400;

function bookKey(book: AvailableTextbook): string {
  return `${book.subject}\u0000${book.version}\u0000${book.volume}`;
}

type Step = 1 | 2 | 3;

function errorText(err: unknown): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  return "操作失败";
}

export function TextbookImportWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (plannedCount: number, autoSchedule: boolean) => void;
}) {
  const { generateFromOutline } = useTaskMutations();
  const [step, setStep] = useState<Step>(1);
  const [books, setBooks] = useState<AvailableTextbook[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [outline, setOutline] = useState<TextbookOutline | null>(null);
  const [openChapters, setOpenChapters] = useState<Set<number>>(() => new Set());
  const [masteredKeys, setMasteredKeys] = useState<Set<string>>(() => new Set());
  const [title, setTitle] = useState("");
  const [autoSchedule, setAutoSchedule] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingOutline, setLoadingOutline] = useState(false);
  const confirmLock = useRef(0);
  const selectedBook = books.find((book) => bookKey(book) === selectedKey) ?? null;

  const plan = useMemo(
    () => (outline ? sectionPlan(outline, masteredKeys) : null),
    [outline, masteredKeys],
  );
  const titleMissing = title.trim().length === 0;

  useEffect(() => {
    let alive = true;
    api
      .listAvailableTextbooks()
      .then((items) => {
        if (!alive) return;
        setBooks(Array.isArray(items) ? items : []);
        if (!Array.isArray(items)) setError("没有读到内置教材");
      })
      .catch((err) => {
        if (alive) setError(errorText(err));
      })
      .finally(() => {
        if (alive) setLoadingBooks(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const loadOutline = async () => {
    if (!selectedBook) return;
    setError(null);
    setLoadingOutline(true);
    try {
      const loaded = await api.getTextbookOutline(
        selectedBook.subject,
        selectedBook.version,
        selectedBook.volume,
      );
      if (loaded.chapters.length === 0) {
        setError("这本教材没有章节");
        return;
      }
      setOutline(loaded);
      setOpenChapters(new Set(loaded.chapters.map((_, index) => index)));
      setMasteredKeys(new Set());
      setTitle(defaultOutlineTaskName(selectedBook));
      setAutoSchedule(true);
      setStep(2);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingOutline(false);
    }
  };

  const toggleSection = (key: string) => {
    setMasteredKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    if (!outline) return;
    const keys = outline.chapters.flatMap((chapter, chapterIndex) =>
      chapter.sections.map((_, sectionIndex) => sectionKey(chapterIndex, sectionIndex)),
    );
    setMasteredKeys(new Set(keys));
  };

  const generate = async () => {
    if (!outline || !plan || titleMissing || generateFromOutline.isPending) return;
    const now = Date.now();
    if (now < confirmLock.current) return;
    confirmLock.current = now + CONFIRM_DEBOUNCE_MS;
    setError(null);
    try {
      const result = await generateFromOutline.mutateAsync({
        subject: outline.subject,
        version: outline.version,
        volume: outline.volume,
        taskName: title.trim(),
        selectedSections: plan.selectedSections,
        autoSchedule,
      });
      onCreated(result.plannedCount, autoSchedule);
    } catch (err) {
      confirmLock.current = 0;
      setError(errorText(err));
    }
  };

  return (
    <Modal
      open
      wide
      title="从教材导入"
      onClose={onClose}
      footer={
        <div className="flex w-full flex-col gap-3">
          <p className="text-left text-xs text-zinc-500">{KNOWLEDGE_POINT_DISCLAIMER}</p>
          <div className="flex justify-end gap-2">
            <Footer
              step={step}
              loadingOutline={loadingOutline}
              generating={generateFromOutline.isPending}
              canSelectBook={selectedBook != null && !loadingBooks}
              canGenerate={!titleMissing}
              onClose={onClose}
              onBack={() => {
                setError(null);
                setStep((current) => (current === 3 ? 2 : 1));
              }}
              onNext={() => {
                if (step === 1) {
                  void loadOutline();
                  return;
                }
                setError(null);
                setStep(3);
              }}
              onGenerate={() => {
                void generate();
              }}
            />
          </div>
        </div>
      }
    >
      <ol className="mb-4 flex gap-2 text-xs text-ink-muted">
        {STEPS.map((label, index) => {
          const current = index + 1 === step;
          return (
            <li key={label} className={current ? "text-accent" : undefined}>
              {index + 1}. {label}
            </li>
          );
        })}
      </ol>

      {step === 1 ? (
        <BookPicker
          books={books}
          loading={loadingBooks}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
        />
      ) : null}

      {step === 2 && outline ? (
        <SectionStep
          outline={outline}
          openChapters={openChapters}
          masteredKeys={masteredKeys}
          onToggleChapter={(index) => {
            setOpenChapters((current) => {
              const next = new Set(current);
              if (next.has(index)) next.delete(index);
              else next.add(index);
              return next;
            });
          }}
          onToggleSection={toggleSection}
          onSelectAll={selectAll}
          onClear={() => setMasteredKeys(new Set())}
        />
      ) : null}

      {step === 3 && plan ? (
        <ConfirmStep
          title={title}
          total={plan.total}
          masteredCount={plan.selectedSections.length}
          plannedCount={plan.planned.length}
          titleMissing={titleMissing}
          autoSchedule={autoSchedule}
          onTitle={setTitle}
          onAutoSchedule={setAutoSchedule}
        />
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

function BookPicker({
  books,
  loading,
  selectedKey,
  onSelect,
}: {
  books: AvailableTextbook[];
  loading: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const groups = groupTextbooksBySubject(books);
  const [subject, setSubject] = useState<string | null>(null);
  if (loading) return <p className="text-sm text-ink-muted">加载教材…</p>;
  if (books.length === 0) return <p className="text-sm text-ink-muted">没有内置教材</p>;
  const activeSubject = groups.some((group) => group.subject === subject)
    ? subject
    : (groups[0]?.subject ?? null);
  const current = groups.find((group) => group.subject === activeSubject);
  return (
    <div>
      <div role="tablist" aria-label="科目" className="mb-3 flex flex-wrap gap-1">
        {groups.map((group) => {
          const selected = group.subject === activeSubject;
          return (
            <button
              key={group.subject}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                selected ? "bg-accent text-white" : "text-ink-muted hover:bg-white/5 hover:text-ink"
              }`}
              onClick={() => setSubject(group.subject)}
            >
              {group.subject}
            </button>
          );
        })}
      </div>
      {current ? (
        <div role="tabpanel" aria-label={current.subject} className="max-h-[24rem] overflow-auto pr-1">
          <div className="grid grid-cols-2 gap-2">
            {current.books.map((book) => {
              const key = bookKey(book);
              const selected = key === selectedKey;
              const track = volumeTrack(book.volume);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${book.subject} ${book.version} ${book.volume}`}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left hover:border-accent/50 ${
                    selected ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-white/10 bg-surface-3"
                  }`}
                  onClick={() => onSelect(key)}
                >
                  <span
                    className="flex h-12 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-display text-white"
                    style={{ background: subjectAccent(book.subject) }}
                    aria-hidden="true"
                  >
                    {book.subject.slice(0, 1)}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm text-ink">{book.subject}</span>
                      {track ? (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] leading-4 ${
                            track === "选择性必修" ? "bg-accent/15 text-accent" : "bg-white/10 text-ink-muted"
                          }`}
                        >
                          {track}
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-xs text-accent">{book.version}</span>
                    <span className="block text-xs text-ink-muted">{book.volume}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionStep({
  outline,
  openChapters,
  masteredKeys,
  onToggleChapter,
  onToggleSection,
  onSelectAll,
  onClear,
}: {
  outline: TextbookOutline;
  openChapters: Set<number>;
  masteredKeys: Set<string>;
  onToggleChapter: (index: number) => void;
  onToggleSection: (key: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-accent">
        勾选你已掌握的节，将直接标记为完成（不增加经验值），为你生成剩下的学习任务。
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-lg px-2 py-1 text-accent hover:bg-accent/10"
          onClick={onSelectAll}
        >
          全选
        </button>
        <button
          type="button"
          className="rounded-lg px-2 py-1 text-ink-muted hover:bg-white/5 hover:text-ink"
          onClick={onClear}
        >
          取消全选
        </button>
      </div>
      <ul className="max-h-72 space-y-2 overflow-auto">
        {outline.chapters.map((chapter, chapterIndex) => {
          const open = openChapters.has(chapterIndex);
          return (
            <li key={chapter.name} className="rounded-xl border border-white/10 bg-surface-3">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-white/5"
                aria-expanded={open}
                onClick={() => onToggleChapter(chapterIndex)}
              >
                <span className="text-ink">{chapter.name}</span>
                <span className="text-xs text-ink-muted">{open ? "收起" : "展开"}</span>
              </button>
              {open ? (
                <ul className="space-y-0.5 px-2 pb-2">
                  {chapter.sections.map((section, sectionIndex) => {
                    const key = sectionKey(chapterIndex, sectionIndex);
                    const preview = knowledgePointPreview(section.knowledge_points);
                    return (
                      <li key={key}>
                        <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 accent-accent"
                            aria-label={section.name}
                            checked={masteredKeys.has(key)}
                            onChange={() => onToggleSection(key)}
                          />
                          <span className="min-w-0">
                            <span className="block text-ink">{section.name}</span>
                            {preview ? (
                              <span className="block text-xs text-zinc-500">{preview}</span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ConfirmStep({
  title,
  total,
  masteredCount,
  plannedCount,
  titleMissing,
  autoSchedule,
  onTitle,
  onAutoSchedule,
}: {
  title: string;
  total: number;
  masteredCount: number;
  plannedCount: number;
  titleMissing: boolean;
  autoSchedule: boolean;
  onTitle: (title: string) => void;
  onAutoSchedule: (value: boolean) => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-ink">
        {autoSchedule
          ? `共 ${total} 节，已掌握 ${masteredCount} 节，将生成 ${plannedCount} 个待办排期。`
          : `共 ${total} 节，已掌握 ${masteredCount} 节。只创建主线任务，不生成排期。`}
      </p>
      <fieldset className="space-y-2">
        <legend className="text-ink-muted">排期方式</legend>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
          <input
            type="radio"
            name="schedule-mode"
            className="mt-1 accent-accent"
            checked={!autoSchedule}
            onChange={() => onAutoSchedule(false)}
          />
          <span>仅创建主线任务，不自动生成排期</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
          <input
            type="radio"
            name="schedule-mode"
            className="mt-1 accent-accent"
            checked={autoSchedule}
            onChange={() => onAutoSchedule(true)}
          />
          <span>为未掌握的章节自动生成排期</span>
        </label>
      </fieldset>
      <label className="block">
        <span className="text-ink-muted">任务名称</span>
        <input
          aria-label="任务名称"
          className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-ink outline-none focus:border-accent/60"
          value={title}
          onChange={(event) => onTitle(event.target.value)}
        />
      </label>
      {titleMissing ? <p className="text-xs text-accent">请填写任务名称</p> : null}
    </div>
  );
}

function Footer({
  step,
  loadingOutline,
  generating,
  canSelectBook,
  canGenerate,
  onClose,
  onBack,
  onNext,
  onGenerate,
}: {
  step: Step;
  loadingOutline: boolean;
  generating: boolean;
  canSelectBook: boolean;
  canGenerate: boolean;
  onClose: () => void;
  onBack: () => void;
  onNext: () => void;
  onGenerate: () => void;
}) {
  return (
    <>
      {step === 1 ? (
        <button type="button" className="rounded-lg px-3 py-2 text-ink-muted hover:bg-white/5" onClick={onClose}>
          取消
        </button>
      ) : (
        <button type="button" className="rounded-lg px-3 py-2 text-ink-muted hover:bg-white/5" onClick={onBack}>
          上一步
        </button>
      )}
      {step < 3 ? (
        <button
          type="button"
          className="rounded-lg bg-accent px-4 py-2 text-white hover:bg-accent-soft disabled:opacity-40"
          onClick={onNext}
          disabled={step === 1 ? !canSelectBook || loadingOutline : false}
        >
          {loadingOutline ? "加载中…" : "下一步"}
        </button>
      ) : (
        <button
          type="button"
          className="rounded-lg bg-accent px-4 py-2 text-white hover:bg-accent-soft disabled:opacity-40"
          onClick={onGenerate}
          disabled={!canGenerate || generating}
          aria-busy={generating}
        >
          {generating ? "生成中…" : "确认生成"}
        </button>
      )}
    </>
  );
}
