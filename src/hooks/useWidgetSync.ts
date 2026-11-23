import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useGoals } from "./useGoals";
import {
  broadcastSessionUpdated,
  SESSION_UPDATED_EVENT,
  WIDGET_READY_EVENT,
} from "../lib/widgetWindow";

/**
 * Widget window: refetch sessions and goals after the main window changed them.
 *
 * 目标现在存在数据库里，两边读的是同一份数据，
 * 所以这里只要让悬浮窗重新拉一次就行，不用再互传目标列表。
 */
export function useWidgetEventBridge() {
  const qc = useQueryClient();

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    const timers: number[] = [];

    const attach = async () => {
      let stop: UnlistenFn;
      try {
        stop = await listen(SESSION_UPDATED_EVENT, () => {
          void qc.invalidateQueries({ queryKey: ["sessions"] });
          void qc.invalidateQueries({ queryKey: ["goals"] });
        });
      } catch {
        return;
      }
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
      const ping = () => {
        try {
          void emit(WIDGET_READY_EVENT).catch(() => undefined);
        } catch {
          /* event API missing outside a Tauri webview */
        }
      };
      ping();
      timers.push(window.setTimeout(ping, 400));
      timers.push(window.setTimeout(ping, 1200));
    };

    void attach().catch(() => undefined);

    return () => {
      cancelled = true;
      for (const id of timers) window.clearTimeout(id);
      unlisten?.();
    };
  }, [qc]);
}

/** Main window: tell the widget to refresh whenever goals change. */
export function useMainWindowBroadcast() {
  const { data: goals = [] } = useGoals();
  const skipMount = useRef(true);

  useEffect(() => {
    if (!isTauri()) return;
    if (skipMount.current) {
      skipMount.current = false;
      return;
    }
    broadcastSessionUpdated();
  }, [goals]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    try {
      void listen(WIDGET_READY_EVENT, () => {
        broadcastSessionUpdated();
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
}