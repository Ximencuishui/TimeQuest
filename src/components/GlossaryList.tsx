import { GLOSSARY } from "../lib/glossary";

/**
 * 术语与数字说明总表（设置页）。
 *
 * 界面上的「?」是就近提示，这里是完整清单，方便一次看完。
 */
export function GlossaryList() {
  return (
    <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
      <h2 className="font-display text-lg">术语与数字说明</h2>
      <p className="mt-1 text-xs text-ink-muted">
        界面上看不懂的词、算不清的数，这里都能查到出处。
      </p>
      <ul className="mt-3 space-y-2">
        {GLOSSARY.map((entry) => (
          <li key={entry.id} className="rounded-lg bg-surface-3/50 px-3 py-2 text-sm">
            <p className="font-display text-ink">{entry.term}</p>
            <p className="mt-1 text-ink-muted">{entry.summary}</p>
            {entry.formula ? (
              <p className="mt-1 text-xs text-ink-muted">口径：{entry.formula}</p>
            ) : null}
            {entry.source ? (
              <p className="mt-0.5 text-xs text-ink-muted">来源：{entry.source}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
