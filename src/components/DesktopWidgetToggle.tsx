import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  setWidgetVisible,
  WIDGET_LABEL,
  WIDGET_VISIBILITY_EVENT,
} from "../lib/widgetWindow";

export function DesktopWidgetToggle() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const win = await WebviewWindow.getByLabel(WIDGET_LABEL);
        if (!win || cancelled) return;
        const visible = await win.isVisible();
        if (!cancelled) setOn(visible);
      } catch {
        /* browser preview has no widget window */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    try {
      void listen<{ visible: boolean }>(WIDGET_VISIBILITY_EVENT, (event) => {
        if (typeof event.payload?.visible === "boolean") {
          setOn(event.payload.visible);
        }
      })
        .then((stop) => {
          if (cancelled) stop();
          else unlisten = stop;
        })
        .catch(() => undefined);
    } catch {
      /* event API missing outside a Tauri webview */
    }
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const toggle = async () => {
    if (!isTauri()) return;
    try {
      const win = await WebviewWindow.getByLabel(WIDGET_LABEL);
      const visible = win ? await win.isVisible() : false;
      await setWidgetVisible(!visible);
      setOn(!visible);
    } catch (error) {
      console.warn("widget toggle failed", error);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="桌面悬浮窗"
      onClick={() => void toggle()}
      className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-surface-3/80 px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
    >
      <span
        aria-hidden="true"
        className={`h-3.5 w-3.5 rounded-full ${on ? "bg-orange-500" : "bg-zinc-600"}`}
      />
      桌面悬浮窗
    </button>
  );
}
