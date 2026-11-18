import type { Note } from "../types";

/**
 * 「这天的便签」区块：绑定到当天日期的提醒。
 *
 * 没有绑定便签时整块不渲染，不在今日计划里留空白占位。
 */
export function DayNotes({ notes }: { notes: Note[] }) {
  if (notes.length === 0) return null;

  return (
    <section
      data-testid="day-notes"
      className="mt-5 rounded-2xl border border-white/5 bg-surface-2/80 p-4"
    >
      <h2 className="mb-2 text-sm font-medium text-ink">这天的便签</h2>
      <ul className="space-y-1.5 text-sm">
        {notes.map((note) => (
          <li key={note.id} className="flex items-start gap-2">
            <span aria-hidden="true" className="text-ink-muted">
              ·
            </span>
            <span className="whitespace-pre-wrap text-ink-muted">
              {note.content}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
