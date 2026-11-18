import { useState } from "react";
import { Modal } from "./Modal";
import { glossaryEntry } from "../lib/glossary";

type Props = {
  /** `src/lib/glossary.ts` 里的词条 id。 */
  id: string;
  className?: string;
};

/**
 * 术语提示：一个小小的「?」，点开是这个词的口径说明。
 *
 * 放在数字旁边，让学生知道「这个数到底怎么来的」。
 */
export function GlossaryHint({ id, className = "" }: Props) {
  const entry = glossaryEntry(id);
  const [open, setOpen] = useState(false);

  if (!entry) return null;

  return (
    <>
      <button
        type="button"
        aria-label={entry.question}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/25 text-ink-muted hover:border-accent hover:text-accent-soft ${className}`}
      >
        {/* 用图标而不是「?」文字：按钮不往父节点的 textContent 里插字符，
            否则「连击 4 天 · 最长 9」这类整行文案会被污染。 */}
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 12 12"
          className="h-2.5 w-2.5"
        >
          <path
            d="M4.1 4.3a1.95 1.95 0 1 1 2.35 2.15c-.42.2-.55.52-.55.92v.28"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <circle cx="5.9" cy="9.7" r="0.72" fill="currentColor" />
        </svg>
      </button>
      <Modal open={open} title={entry.term} onClose={() => setOpen(false)}>
        <div className="space-y-2 text-sm">
          <p className="text-ink">{entry.summary}</p>
          {entry.formula ? (
            <p className="rounded-lg bg-surface-3/70 px-3 py-2 text-xs text-ink-muted">
              口径：{entry.formula}
            </p>
          ) : null}
          {entry.source ? (
            <p className="text-xs text-ink-muted">来源：{entry.source}</p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
