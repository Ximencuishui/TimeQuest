import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type Props = {
  open: boolean;
  period: string;
  rangeLabel: string;
  markdown: string;
  onClose: () => void;
};

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={key} className="font-semibold text-accent-soft">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

function ReportBody({ markdown }: { markdown: string }) {
  const blocks = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== "");

  return (
    <div className="space-y-6 text-[17px] leading-[1.95] text-ink">
      {blocks.map((block, index) => {
        const closing = blocks.length > 1 && index === blocks.length - 1;
        const lines = block.split("\n");
        return (
          <p
            key={`${index}-${block.slice(0, 12)}`}
            className={closing ? "text-ink-muted italic" : undefined}
          >
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {renderInline(line, `${index}-${lineIndex}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export function LearningReportDialog({
  open,
  period,
  rangeLabel,
  markdown,
  onClose,
}: Props) {
  const titleId = useId();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCopied(false);
    setCopyError(false);
  }, [markdown, open]);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const title = `${period}学习复盘`;

  async function onCopy() {
    const payload = `${title}\n${rangeLabel}\n\n${markdown}`;
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="learning-report-dialog"
        className="relative flex max-h-[min(88vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-surface/80 shadow-2xl backdrop-blur-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at top, rgba(249,115,22,0.18), transparent 52%), radial-gradient(rgba(255,255,255,0.14) 0.6px, transparent 0.65px)",
            backgroundSize: "100% 100%, 7px 7px",
          }}
        />
        <div className="relative h-px shrink-0 bg-gradient-to-r from-transparent via-accent/80 to-transparent" />
        <div className="relative flex shrink-0 items-start justify-between gap-4 px-8 pt-7 sm:px-10">
          <div>
            <div className="text-xs tracking-[0.22em] text-accent">复盘</div>
            <h2 id={titleId} className="mt-2 font-display text-2xl text-ink">
              {title}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">{rangeLabel}</p>
          </div>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-ink-muted hover:bg-white/5"
            onClick={onClose}
            aria-label="关闭报告"
          >
            ✕
          </button>
        </div>
        <div className="relative min-h-0 flex-1 overflow-auto px-8 py-6 sm:px-10">
          <ReportBody markdown={markdown} />
        </div>
        <div className="relative flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-white/10 px-8 py-5 sm:px-10">
          {copyError ? (
            <p className="mr-auto text-sm text-ink-muted">复制失败，请手动选择文字。</p>
          ) : null}
          <button
            type="button"
            className="min-w-24 rounded-lg bg-accent px-4 py-2 text-sm text-white hover:brightness-110"
            onClick={() => {
              void onCopy();
            }}
          >
            {copied ? "已复制" : "复制文本"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-ink-muted hover:bg-white/5"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
