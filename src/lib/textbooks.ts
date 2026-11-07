import type { TextbookOutline } from "../types";

export type TextbookCatalogEntry = {
  subject: string;
  version: string;
  volume: string;
  label: string;
};

/** Books the wizard can request. Keys match `get_textbook_outline`. */
export const TEXTBOOK_CATALOG: TextbookCatalogEntry[] = [
  {
    subject: "数学",
    version: "人教版",
    volume: "必修第一册",
    label: "人教版 · 必修第一册",
  },
];

export function textbookKey(entry: Pick<TextbookCatalogEntry, "version" | "volume">): string {
  return `${entry.version}\u0000${entry.volume}`;
}

/** Default name filled in on the confirm step for the built-in math book. */
export const DEFAULT_OUTLINE_TASK_NAME = "数学必修一";

export type AvailableTextbook = {
  subject: string;
  version: string;
  volume: string;
};

const SUBJECT_ACCENT: Record<string, string> = {
  数学: "#F97316",
  语文: "#FB7185",
  英语: "#FBBF24",
  物理: "#38BDF8",
  化学: "#34D399",
  生物: "#2DD4BF",
};

/** Wizard groups follow this order. Subjects outside the list stay at the end. */
export const SUBJECT_GROUP_ORDER = ["数学", "语文", "英语", "物理", "化学", "生物"] as const;

const CN_ORDINAL: Record<string, number> = {
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

/** 册别标签。卷名含「选择性必修」时归入选修，只含「必修」时归入必修。 */
export function volumeTrack(volume: string): "选择性必修" | "必修" | null {
  if (volume.includes("选择性必修")) return "选择性必修";
  if (volume.includes("必修")) return "必修";
  return null;
}

function volumeIndex(volume: string): number {
  const cn = /第([一二三四五六七八九])/.exec(volume);
  if (cn?.[1]) return CN_ORDINAL[cn[1]] ?? 99;
  const digit = /(\d+)/.exec(volume);
  if (digit?.[1]) return Number(digit[1]);
  if (volume.includes("上册")) return 1;
  if (volume.includes("中册")) return 2;
  if (volume.includes("下册")) return 3;
  return 99;
}

function compareCatalogBooks<T extends { version: string; volume: string }>(left: T, right: T): number {
  const version = left.version.localeCompare(right.version, "zh");
  if (version !== 0) return version;
  const track =
    (volumeTrack(left.volume) === "选择性必修" ? 1 : 0) -
    (volumeTrack(right.volume) === "选择性必修" ? 1 : 0);
  if (track !== 0) return track;
  const index = volumeIndex(left.volume) - volumeIndex(right.volume);
  if (index !== 0) return index;
  return left.volume.localeCompare(right.volume, "zh");
}

export function groupTextbooksBySubject<T extends { subject: string; version: string; volume: string }>(
  books: readonly T[],
): { subject: string; books: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const book of books) {
    const list = buckets.get(book.subject);
    if (list) list.push(book);
    else buckets.set(book.subject, [book]);
  }
  const groups: { subject: string; books: T[] }[] = [];
  for (const subject of SUBJECT_GROUP_ORDER) {
    const list = buckets.get(subject);
    if (!list) continue;
    groups.push({ subject, books: [...list].sort(compareCatalogBooks) });
    buckets.delete(subject);
  }
  for (const [subject, list] of buckets) {
    groups.push({ subject, books: [...list].sort(compareCatalogBooks) });
  }
  return groups;
}

export function subjectAccent(subject: string): string {
  return SUBJECT_ACCENT[subject] ?? "#F97316";
}

/** Volumes matching the typed text, grouped in subject order. An empty query returns every book. */
export function textbookSuggestions<T extends AvailableTextbook>(
  books: readonly T[],
  query: string,
): T[] {
  const q = query.trim();
  const matched = q
    ? books.filter((book) => `${book.subject}${book.version}${book.volume}`.includes(q))
    : [...books];
  return groupTextbooksBySubject(matched).flatMap((group) => group.books);
}

export function defaultOutlineTaskName(book: Pick<AvailableTextbook, "subject" | "volume">): string {
  if (book.subject === "数学" && book.volume === "必修第一册") return DEFAULT_OUTLINE_TASK_NAME;
  return `${book.subject} · ${book.volume}`;
}

export function sectionKey(chapterIndex: number, sectionIndex: number): string {
  return `${chapterIndex}:${sectionIndex}`;
}

/** Knowledge points under a section name, separated by commas. */
export function knowledgePointPreview(points: readonly string[] | undefined): string {
  if (!points) return "";
  return points
    .map((point) => point.trim())
    .filter((point) => point.length > 0)
    .join("，");
}

export type PlannedSection = {
  chapter: string;
  section: string;
};

/**
 * Checked section keys become `selectedSections` in outline order, not click order.
 * Keys come from `sectionKey(chapterIndex, sectionIndex)`.
 */
export function sectionPlan(
  outline: TextbookOutline,
  masteredSectionKeys: ReadonlySet<string>,
): { total: number; selectedSections: string[]; planned: PlannedSection[] } {
  const selectedSections: string[] = [];
  const planned: PlannedSection[] = [];
  let total = 0;
  outline.chapters.forEach((chapter, chapterIndex) => {
    chapter.sections.forEach((section, sectionIndex) => {
      total += 1;
      if (masteredSectionKeys.has(sectionKey(chapterIndex, sectionIndex))) {
        selectedSections.push(section.name);
      } else {
        planned.push({ chapter: chapter.name, section: section.name });
      }
    });
  });
  return { total, selectedSections, planned };
}
