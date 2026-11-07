import type { AvailableTextbook, TextbookOutline } from "../types";

export const SECTION_EXISTS_MESSAGE = "该节已存在，请直接在内添加考点";

/** Section titles in chapter order. Blank and repeated names are dropped. */
export function outlineSectionNames(outline: TextbookOutline | null | undefined): string[] {
  if (!outline) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const chapter of outline.chapters ?? []) {
    for (const section of chapter.sections ?? []) {
      const name = section.name.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** Preset knowledge points keyed by trimmed section title. Blank and repeated names are dropped. */
export function outlinePointsBySection(
  outline: TextbookOutline | null | undefined,
): Record<string, string[]> {
  const pointsBySection: Record<string, string[]> = {};
  if (!outline) return pointsBySection;
  for (const chapter of outline.chapters ?? []) {
    for (const section of chapter.sections ?? []) {
      const name = section.name.trim();
      if (!name || pointsBySection[name]) continue;
      const seen = new Set<string>();
      const points: string[] = [];
      for (const raw of section.knowledge_points ?? []) {
        const point = raw.trim();
        if (!point || seen.has(point)) continue;
        seen.add(point);
        points.push(point);
      }
      pointsBySection[name] = points;
    }
  }
  return pointsBySection;
}

const CN_VOLUME_INDEX: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 人教A版 is the name students use for the builtin 人教版 books. */
function canonicalTextbookLabel(label: string): string {
  return label.replace(/人教A版/g, "人教版");
}

/** 必修一 / 必修第一册 / 选择性必修二 → track + index. */
function volumeOrdinal(text: string): { elective: boolean; index: number } | null {
  const compact = text.replace(/\s/g, "");
  const elective = compact.includes("选择性必修") || compact.includes("选必");
  const pattern = elective
    ? /(?:选择性必修|选必)第?([一二三四五六七八九]|\d+)/
    : /必修第?([一二三四五六七八九]|\d+)/;
  const match = pattern.exec(compact);
  if (!match) return null;
  const token = match[1] ?? "";
  const index = CN_VOLUME_INDEX[token] ?? Number(token);
  if (!Number.isInteger(index) || index <= 0) return null;
  return { elective, index };
}

/**
 * Match a task's stored textbook label to a catalog book.
 * Generated tasks store `"版本 册别"`. The manual form stores the volume alone.
 * Demo rows store `人教A版` and put the volume in the task title (`数学必修一`).
 */
export function matchTextbook(
  books: readonly AvailableTextbook[],
  subject: string,
  textbook: string,
  title = "",
): AvailableTextbook | null {
  const subjectName = subject.trim();
  if (!subjectName) return null;
  const sameSubject = books.filter((book) => book.subject === subjectName);
  if (sameSubject.length === 0) return null;

  const label = textbook.trim();
  if (label) {
    const compactLabel = label.replace(/\s/g, "");
    const full = sameSubject.find((book) => {
      const stored = `${book.version} ${book.volume}`;
      return stored === label || stored.replace(/\s/g, "") === compactLabel;
    });
    if (full) return full;
    const byVolume = sameSubject.filter((book) => book.volume === label);
    if (byVolume.length === 1) return byVolume[0]!;
  }

  const hint = canonicalTextbookLabel(`${label} ${title}`.trim());
  if (!hint) return null;
  const wanted = volumeOrdinal(hint);
  const versionMatched = sameSubject.filter((book) => hint.includes(book.version));
  const pool = versionMatched.length > 0 ? versionMatched : sameSubject;
  if (wanted) {
    const narrowed = pool.filter((book) => {
      const ordinal = volumeOrdinal(book.volume);
      return (
        ordinal !== null &&
        ordinal.elective === wanted.elective &&
        ordinal.index === wanted.index
      );
    });
    if (narrowed.length === 1) return narrowed[0]!;
    const named = narrowed.filter((book) => hint.includes(book.version));
    if (named.length === 1) return named[0]!;
  }
  return pool.length === 1 ? pool[0]! : null;
}

export function takenSectionNames(
  points: readonly { section_name: string }[],
  drafts: readonly string[],
): Set<string> {
  const taken = new Set<string>();
  for (const point of points) {
    const name = point.section_name.trim();
    if (name) taken.add(name);
  }
  for (const draft of drafts) {
    const name = draft.trim();
    if (name) taken.add(name);
  }
  return taken;
}

/** Substring filter. An empty query keeps the catalog order. */
export function filterSectionOptions(sections: readonly string[], query: string): string[] {
  const needle = query.trim();
  if (!needle) return [...sections];
  return sections.filter((section) => section.includes(needle));
}

export type SectionChoice =
  | { kind: "empty" }
  | { kind: "exists" }
  | { kind: "catalog"; name: string }
  | { kind: "custom"; name: string };

/**
 * Form submit prefers an exact catalog title, then the highlighted catalog hit.
 * A name that only partially matches the catalog is not saved as a new section.
 * `forceCustom` is the explicit「使用这个节名」action.
 */
export function resolveSectionChoice(
  raw: string,
  catalog: readonly string[],
  taken: ReadonlySet<string>,
  filtered: readonly string[],
  activeIndex: number,
  forceCustom = false,
): SectionChoice {
  const name = raw.trim();
  if (!name) return { kind: "empty" };
  const exact = catalog.find((section) => section === name);
  if (exact) {
    return taken.has(exact) ? { kind: "exists" } : { kind: "catalog", name: exact };
  }
  if (taken.has(name)) return { kind: "exists" };
  if (!forceCustom) {
    const available = filtered.filter((section) => !taken.has(section));
    if (available.length > 0) {
      const index = Math.min(Math.max(activeIndex, 0), available.length - 1);
      return { kind: "catalog", name: available[index]! };
    }
    if (filtered.length > 0) return { kind: "exists" };
  }
  return { kind: "custom", name };
}
