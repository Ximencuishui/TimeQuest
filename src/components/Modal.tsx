import type { ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
};

export function Modal({ open, title, onClose, children, footer, wide = false }: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface-2 shadow-2xl ${
          wide ? "max-w-lg" : "max-w-md"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题与页脚固定，只有中间的内容滚动：长表单（常用时段、任务表单）也能随时点到保存。 */}
        <div className="flex items-start justify-between gap-3 border-b border-white/5 p-5 pb-3">
          <h2 className="font-display text-lg text-ink">{title}</h2>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-ink-muted hover:bg-white/5"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-white/5 p-5 pt-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
