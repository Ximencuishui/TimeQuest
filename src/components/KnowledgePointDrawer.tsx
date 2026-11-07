import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useAddCustomKnowledgePoint,
  useDeleteKnowledgePoint,
  useTask,
  useTaskKnowledgePoints,
  useTextbookSections,
  useToggleKnowledgePoint,
} from "../hooks/useTasks";
import { KNOWLEDGE_POINT_DISCLAIMER } from "../lib/constants";
import {
  SECTION_EXISTS_MESSAGE,
  filterSectionOptions,
  resolveSectionChoice,
  takenSectionNames,
} from "../lib/sectionCatalog";
import type { TaskKnowledgePoint } from "../types";

const SECTION_CHECK_MS = 300;
const CUSTOM_POINT_PLACEHOLDER = "没找到？手动添加自定义考点...";

export type KnowledgeTask = {
  id: number;
  title: string;
  subject?: string | null;
  textbook?: string | null;
};

function errorText(err: unknown): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  return "操作失败";
}

/** Keep a section's points together even when a later insert has a higher id. */
function groupPoints(
  points: TaskKnowledgePoint[],
  draftSections: string[],
): { section: string; points: TaskKnowledgePoint[] }[] {
  const groups: { section: string; points: TaskKnowledgePoint[] }[] = [];
  const indexBySection = new Map<string, number>();
  for (const point of points) {
    const existing = indexBySection.get(point.section_name);
    if (existing == null) {
      indexBySection.set(point.section_name, groups.length);
      groups.push({ section: point.section_name, points: [point] });
    } else {
      groups[existing]!.points.push(point);
    }
  }
  for (const section of draftSections) {
    const name = section.trim();
    if (!name || indexBySection.has(name)) continue;
    indexBySection.set(name, groups.length);
    groups.push({ section: name, points: [] });
  }
  return groups;
}

function PointComposer({
  section,
  presets,
  taken,
  draftName,
  pending,
  onDraftName,
  onPick,
  onSubmitCustom,
}: {
  section: string;
  presets: string[];
  taken: Set<string>;
  draftName: string;
  pending: boolean;
  onDraftName: (value: string) => void;
  onPick: (name: string) => void;
  onSubmitCustom: () => void;
}) {
  const input = (
    <form
      className="mt-2 flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitCustom();
      }}
    >
      <input
        aria-label={`新考点 ${section}`}
        placeholder={presets.length > 0 ? CUSTOM_POINT_PLACEHOLDER : undefined}
        className="min-w-0 flex-1 rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-orange-500"
        value={draftName}
        onChange={(event) => onDraftName(event.target.value)}
        autoFocus
      />
      <button
        type="submit"
        className="text-xs text-orange-400 disabled:opacity-40"
        disabled={!draftName.trim() || pending}
      >
        添加
      </button>
    </form>
  );

  if (presets.length === 0) return input;

  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-zinc-900/80 p-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`标准考点 ${section}`}>
        {presets.map((name) => {
          const already = taken.has(name);
          return (
            <button
              key={name}
              type="button"
              disabled={already || pending}
              aria-label={already ? `已添加 ${name}` : name}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                already
                  ? "cursor-not-allowed border-white/10 bg-zinc-800 text-zinc-500"
                  : "border-orange-500/50 bg-orange-500/10 text-orange-100 hover:bg-orange-500/20"
              }`}
              onClick={() => {
                if (already || pending) return;
                onPick(name);
              }}
            >
              {already ? `✓ ${name}` : name}
            </button>
          );
        })}
      </div>
      {input}
    </div>
  );
}

export function KnowledgePointList({
  points,
  taskId,
  draftSections = [],
  standardPoints = {},
}: {
  points: TaskKnowledgePoint[];
  taskId?: number;
  draftSections?: string[];
  /** Preset point names from the textbook outline, keyed by section title. */
  standardPoints?: Record<string, string[]>;
}) {
  const toggle = useToggleKnowledgePoint();
  const add = useAddCustomKnowledgePoint();
  const remove = useDeleteKnowledgePoint();
  const [composer, setComposer] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const groups = groupPoints(points, draftSections);

  const savePoint = async (section: string, name: string, closeOnSuccess: boolean) => {
    if (taskId == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setFormError(null);
    try {
      await add.mutateAsync({ taskId, sectionName: section, name: trimmed });
      if (closeOnSuccess) {
        setComposer(null);
        setDraftName("");
      }
    } catch (err) {
      setFormError(errorText(err));
    }
  };

  return (
    <ul className="space-y-4">
      {groups.map((group) => (
        <li key={group.section}>
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 text-sm text-zinc-200">{group.section}</p>
            {taskId != null ? (
              <button
                type="button"
                className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300"
                aria-label={`添加考点 ${group.section}`}
                onClick={() => {
                  setComposer(group.section);
                  setDraftName("");
                  setFormError(null);
                }}
              >
                + 添加考点
              </button>
            ) : null}
          </div>
          {composer === group.section ? (
            <PointComposer
              section={group.section}
              presets={standardPoints[group.section.trim()] ?? []}
              taken={new Set(group.points.map((point) => point.name.trim()))}
              draftName={draftName}
              pending={add.isPending}
              onDraftName={setDraftName}
              onPick={(name) => void savePoint(group.section, name, false)}
              onSubmitCustom={() => void savePoint(group.section, draftName, true)}
            />
          ) : null}
          {composer === group.section && formError ? (
            <p className="mt-1 text-xs text-orange-400">{formError}</p>
          ) : null}
          <ul className="mt-2 space-y-1.5">
            {group.points.map((point) => {
              const mastered = point.is_mastered === 1;
              return (
                <li key={point.id} className="group flex items-start gap-1">
                  <label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-orange-500"
                      checked={mastered}
                      aria-label={point.name}
                      disabled={toggle.isPending}
                      onChange={() => toggle.mutate(point.id)}
                    />
                    <span className={mastered ? "text-green-400 line-through" : "text-zinc-200"}>
                      {point.name}
                    </span>
                  </label>
                  {taskId != null ? (
                    <button
                      type="button"
                      className="mt-0.5 shrink-0 text-xs text-zinc-500 opacity-0 hover:text-zinc-300 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                      aria-label={`删除 ${point.name}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(point.id)}
                    >
                      ✕
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function KnowledgePointDrawer({
  task,
  onClose,
}: {
  task: KnowledgeTask | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useTaskKnowledgePoints(task?.id ?? null);
  const loadedTask = useTask(task?.id ?? null);
  const points = Array.isArray(data) ? data : [];
  const [draftSections, setDraftSections] = useState<string[]>([]);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionDraft, setSectionDraft] = useState("");
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const subject = task?.subject ?? loadedTask.data?.subject;
  const textbook = task?.textbook ?? loadedTask.data?.textbook;
  const catalogQuery = useTextbookSections(subject, textbook, task?.title);
  const catalog = catalogQuery.data?.sections ?? [];
  const pointsBySection = catalogQuery.data?.pointsBySection ?? {};

  useEffect(() => {
    setDraftSections([]);
    setAddingSection(false);
    setSectionDraft("");
    setSectionError(null);
  }, [task?.id]);

  useEffect(() => {
    if (!Array.isArray(data) || data.length === 0) return;
    setDraftSections((current) => {
      const next = current.filter(
        (section) => !data.some((point) => point.section_name.trim() === section.trim()),
      );
      return next.length === current.length ? current : next;
    });
  }, [data]);

  const taken = useMemo(
    () => takenSectionNames(points, draftSections),
    [points, draftSections],
  );
  const filtered = useMemo(
    () => filterSectionOptions(catalog, sectionDraft),
    [catalog, sectionDraft],
  );
  const available = useMemo(
    () => filtered.filter((section) => !taken.has(section)),
    [filtered, taken],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [sectionDraft, addingSection]);

  useEffect(() => {
    if (!addingSection) return;
    const timer = window.setTimeout(() => {
      const name = sectionDraft.trim();
      if (!name) {
        setSectionError(null);
        return;
      }
      const choice = resolveSectionChoice(name, catalog, taken, filtered, 0);
      setSectionError(choice.kind === "exists" ? SECTION_EXISTS_MESSAGE : null);
    }, SECTION_CHECK_MS);
    return () => window.clearTimeout(timer);
  }, [addingSection, sectionDraft, catalog, taken, filtered]);

  if (!task) return null;

  const acceptSection = (name: string) => {
    setDraftSections((current) => (current.includes(name) ? current : [...current, name]));
    setSectionDraft("");
    setAddingSection(false);
    setSectionError(null);
  };

  const confirmSection = (forceCustom = false) => {
    const choice = resolveSectionChoice(
      sectionDraft,
      catalog,
      taken,
      filtered,
      activeIndex,
      forceCustom,
    );
    if (choice.kind === "empty") return;
    if (choice.kind === "exists") {
      setSectionError(SECTION_EXISTS_MESSAGE);
      return;
    }
    acceptSection(choice.name);
  };

  const trimmedDraft = sectionDraft.trim();
  const showCustom =
    trimmedDraft.length > 0 &&
    !catalog.includes(trimmedDraft) &&
    !taken.has(trimmedDraft);

  const showEmpty = !isLoading && points.length === 0 && draftSections.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={`${task.title} 知识点`}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <aside
        className="flex h-full w-full max-w-md flex-col border-l border-white/10 bg-zinc-950 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-ink-muted">知识点</p>
            <h2 className="mt-1 truncate font-display text-lg text-ink">{task.title}</h2>
          </div>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-ink-muted hover:bg-white/5"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="mb-3 shrink-0">
          {addingSection ? (
            <form
              className="relative"
              onSubmit={(event) => {
                event.preventDefault();
                confirmSection(false);
              }}
            >
              <div className="flex items-center gap-2">
                <input
                  aria-label="节名称"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  autoComplete="off"
                  placeholder="搜索教材里的节，或输入新节名"
                  className="min-w-0 flex-1 rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-orange-500"
                  value={sectionDraft}
                  onChange={(event) => setSectionDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setAddingSection(false);
                      setSectionDraft("");
                      setSectionError(null);
                      return;
                    }
                    if (available.length === 0) return;
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setActiveIndex((index) => (index + 1) % available.length);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveIndex(
                        (index) => (index - 1 + available.length) % available.length,
                      );
                    }
                  }}
                  autoFocus
                />
                <button
                  type="submit"
                  className="text-xs text-orange-400 disabled:opacity-40"
                  disabled={!trimmedDraft}
                >
                  添加
                </button>
                <button
                  type="button"
                  className="text-xs text-zinc-500"
                  onClick={() => {
                    setAddingSection(false);
                    setSectionDraft("");
                    setSectionError(null);
                  }}
                >
                  取消
                </button>
              </div>
              <ul
                id={listId}
                role="listbox"
                aria-label="教材节"
                className="mt-1 max-h-48 overflow-auto rounded-lg border border-white/10 bg-zinc-900 py-1"
              >
                {catalogQuery.isLoading ? (
                  <li className="px-2 py-1.5 text-xs text-zinc-500">正在读取教材目录…</li>
                ) : filtered.length === 0 ? (
                  <li className="px-2 py-1.5 text-xs text-zinc-500">
                    {catalog.length === 0 ? "这本教材没有可选的节" : "目录里没有匹配的节"}
                  </li>
                ) : (
                  filtered.map((section) => {
                    const already = taken.has(section);
                    const availableIndex = available.indexOf(section);
                    const highlighted = !already && availableIndex === activeIndex;
                    return (
                      <li key={section} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={highlighted}
                          aria-disabled={already}
                          disabled={already}
                          className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs ${
                            already
                              ? "cursor-not-allowed text-zinc-600"
                              : highlighted
                                ? "bg-orange-500/15 text-zinc-100"
                                : "text-zinc-200 hover:bg-white/5"
                          }`}
                          onClick={() => acceptSection(section)}
                        >
                          <span className="min-w-0 truncate">{section}</span>
                          {already ? <span className="shrink-0">已有</span> : null}
                        </button>
                      </li>
                    );
                  })
                )}
                {showCustom ? (
                  <li role="presentation">
                    <button
                      type="button"
                      className="w-full px-2 py-1.5 text-left text-xs text-orange-300 hover:bg-white/5"
                      onClick={() => confirmSection(true)}
                    >
                      使用「{trimmedDraft}」
                    </button>
                  </li>
                ) : null}
              </ul>
            </form>
          ) : (
            <button
              type="button"
              className="text-xs text-zinc-500 hover:text-zinc-300"
              aria-label="添加节"
              onClick={() => {
                setAddingSection(true);
                setSectionError(null);
              }}
            >
              + 添加节
            </button>
          )}
          {sectionError ? <p className="mt-1 text-xs text-orange-400">{sectionError}</p> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <p className="text-sm text-ink-muted">加载中…</p>
          ) : showEmpty ? (
            <p className="text-sm text-ink-muted">暂无考点，可点击上方按钮手动添加</p>
          ) : (
            <KnowledgePointList
              points={points}
              taskId={task.id}
              draftSections={draftSections}
              standardPoints={pointsBySection}
            />
          )}
        </div>
        <Link
          to={`/tasks/${task.id}`}
          className="mt-4 text-sm text-accent-soft hover:underline"
          onClick={onClose}
        >
          查看排期
        </Link>
        <p className="mt-3 text-xs text-zinc-500">{KNOWLEDGE_POINT_DISCLAIMER}</p>
      </aside>
    </div>
  );
}
