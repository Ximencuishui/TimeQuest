import { useEffect, useState } from "react";
import { BACKEND_ERROR_EVENT, backendErrorDetail } from "../lib/backendError";

type Toast = { id: number; text: string };

/** 所有未被页面单独处理的 command 失败，都在这里给用户一个可见提示。 */
export function BackendErrorToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onError = (event: Event) => {
      const error = (event as CustomEvent<unknown>).detail;
      const text = backendErrorDetail(error, "操作失败，请重试。");
      setToasts((prev) => {
        if (prev.some((toast) => toast.text === text)) return prev;
        return [...prev.slice(-2), { id: Date.now() + Math.random(), text }];
      });
    };
    window.addEventListener(BACKEND_ERROR_EVENT, onError);
    return () => window.removeEventListener(BACKEND_ERROR_EVENT, onError);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => setToasts((prev) => prev.slice(1)), 5000);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-5 left-1/2 z-[70] flex w-[min(90vw,32rem)] -translate-x-1/2 flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className="rounded-lg border border-amber-300/40 bg-surface-2 px-4 py-2 text-sm text-ink shadow-xl"
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}
