import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  clampFocusMinutes,
  DEFAULT_FOCUS_MINUTES,
  FOCUS_LEAVE_MESSAGE,
  formatFocusClock,
  MIN_FOCUS_MINUTES,
} from "../lib/focusClock";
import { notifyFocusFinished, playFocusChime } from "../lib/focusAlert";
import { useUiStore } from "../store/ui";

type Props = {
  title: string;
  /** Countdown length. Defaults to a 25-minute pomodoro. */
  durationMinutes?: number;
  /** Timer hit zero, or the user pressed 提前完成. */
  onComplete: () => void;
  /** Leave without changing the session. */
  onAbandon: () => void;
};

export function FocusMode({
  title,
  durationMinutes = DEFAULT_FOCUS_MINUTES,
  onComplete,
  onAbandon,
}: Props) {
  const initialMinutes = clampFocusMinutes(durationMinutes);
  const remainingRef = useRef(initialMinutes * 60);
  const fired = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const onAbandonRef = useRef(onAbandon);
  const titleRef = useRef(title);
  onCompleteRef.current = onComplete;
  onAbandonRef.current = onAbandon;
  titleRef.current = title;

  const [remaining, setRemaining] = useState(initialMinutes * 60);
  const [minutesDraft, setMinutesDraft] = useState(String(initialMinutes));
  const [noiseOn, setNoiseOn] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (fired.current) return;
      const next = Math.max(0, remainingRef.current - 1);
      remainingRef.current = next;
      setRemaining(next);
      if (next > 0) return;
      fired.current = true;
      window.clearInterval(id);
      playFocusChime();
      notifyFocusFinished(titleRef.current);
      onCompleteRef.current();
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = FOCUS_LEAVE_MESSAGE;
      return FOCUS_LEAVE_MESSAGE;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let win: ReturnType<typeof getCurrentWindow> | null = null;
    try {
      win = getCurrentWindow();
    } catch {
      return;
    }
    void win.setAlwaysOnTop(true).catch(() => undefined);
    const held = win;
    return () => {
      const pref = useUiStore.getState().alwaysOnTop;
      void held.setAlwaysOnTop(pref).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    let released = false;
    let lock: WakeLockSentinel | null = null;
    const request = () => {
      if (released || !navigator.wakeLock?.request) return;
      void navigator.wakeLock
        .request("screen")
        .then((sentinel) => {
          if (released) {
            void sentinel.release();
            return;
          }
          lock = sentinel;
        })
        .catch(() => undefined);
    };
    request();
    return () => {
      released = true;
      void lock?.release();
    };
  }, []);

  useEffect(() => {
    if (!noiseOn) return;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    let ctx: AudioContext | null = null;
    let source: AudioBufferSourceNode | null = null;
    try {
      ctx = new Ctx();
      const length = Math.max(1, Math.floor(ctx.sampleRate));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) channel[i] = Math.random() * 2 - 1;
      const gain = ctx.createGain();
      gain.gain.value = 0.03;
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    } catch {
      ctx = null;
      source = null;
    }
    return () => {
      try {
        source?.stop();
      } catch {
        /* already stopped */
      }
      void ctx?.close();
    };
  }, [noiseOn]);

  function applyMinutes(next: number) {
    if (fired.current) return;
    remainingRef.current = next * 60;
    setRemaining(next * 60);
  }

  function commitMinutes() {
    if (!/^\d+$/.test(minutesDraft)) {
      setMinutesDraft(String(Math.ceil(remainingRef.current / 60) || MIN_FOCUS_MINUTES));
      return;
    }
    const parsed = clampFocusMinutes(Number(minutesDraft));
    setMinutesDraft(String(parsed));
    applyMinutes(parsed);
  }

  function pickMinutes(next: number) {
    const parsed = clampFocusMinutes(next);
    setMinutesDraft(String(parsed));
    applyMinutes(parsed);
  }

  function finishEarly() {
    if (fired.current) return;
    fired.current = true;
    onCompleteRef.current();
  }

  function abandon() {
    if (fired.current) return;
    fired.current = true;
    onAbandonRef.current();
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="专注"
      data-testid="focus-mode"
      className="fixed inset-0 z-[80] flex flex-col bg-[#07090c]/95 text-ink backdrop-blur-md"
    >
      <header className="px-6 pt-12 text-center">
        <p className="text-xs tracking-[0.28em] text-accent">专注</p>
        <h1 className="mx-auto mt-4 max-w-2xl font-display text-2xl leading-snug sm:text-3xl">
          {title}
        </h1>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <p
          data-testid="focus-clock"
          className="font-mono text-7xl leading-none font-semibold tracking-tight text-ink tabular-nums sm:text-8xl"
        >
          {formatFocusClock(remaining)}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
          {[25, 45].map((choice) => (
            <button
              key={choice}
              type="button"
              className="rounded-full border border-white/15 px-3 py-1 text-ink-muted hover:bg-white/5"
              onClick={() => pickMinutes(choice)}
            >
              {choice} 分钟
            </button>
          ))}
          <label className="flex items-center gap-2 text-ink-muted">
            自定义
            <input
              type="text"
              inputMode="numeric"
              aria-label="专注分钟"
              className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center font-mono text-ink tabular-nums"
              value={minutesDraft}
              onChange={(event) => setMinutesDraft(event.target.value)}
              onBlur={commitMinutes}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        </div>
        <button
          type="button"
          aria-pressed={noiseOn}
          className={`rounded-full border px-4 py-1.5 text-sm ${
            noiseOn
              ? "border-accent/50 bg-accent/15 text-accent-soft"
              : "border-white/15 text-ink-muted hover:bg-white/5"
          }`}
          onClick={() => setNoiseOn((on) => !on)}
        >
          {noiseOn ? "白噪音 · 播放中" : "白噪音"}
        </button>
      </div>

      <footer className="flex items-center justify-center gap-3 px-6 pb-12">
        <button
          type="button"
          className="rounded-lg border border-white/15 px-5 py-2.5 text-sm text-ink-muted hover:bg-white/5"
          onClick={abandon}
        >
          放弃
        </button>
        <button
          type="button"
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:brightness-110"
          onClick={finishEarly}
        >
          提前完成
        </button>
      </footer>
    </div>,
    document.body,
  );
}
