import { useEffect, useState } from "react";
import { useCelebrationStore } from "../lib/celebration";

const FADE_MS = 2000;
const REMOVE_MS = 2400;

/** 屏幕中央的里程碑浮层。不接收点击，两秒后淡出。 */
export function CelebrationHost() {
  const message = useCelebrationStore((state) => state.message);
  const token = useCelebrationStore((state) => state.token);
  const clear = useCelebrationStore((state) => state.clear);
  const [phase, setPhase] = useState<"visible" | "fading">("visible");

  useEffect(() => {
    if (!message) return;
    setPhase("visible");
    const fade = window.setTimeout(() => setPhase("fading"), FADE_MS);
    const done = window.setTimeout(() => clear(), REMOVE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [message, token, clear]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="celebration-overlay"
      data-state={phase}
      className={`pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-6 transition-opacity duration-300 ${
        phase === "visible" ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="pointer-events-none max-w-md rounded-3xl border border-orange-500/30 bg-zinc-950/75 px-8 py-6 text-center shadow-2xl ring-1 ring-orange-500/20 backdrop-blur-md">
        <p className="font-display text-lg leading-relaxed text-zinc-100">
          {message}
        </p>
      </div>
    </div>
  );
}
