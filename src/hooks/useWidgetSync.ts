import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useUiStore } from "../store/ui";
import {
  broadcastExams,
  isExamList,
  SESSION_UPDATED_EVENT,
  WIDGET_READY_EVENT,
  type SessionUpdatedPayload,
} from "../lib/widgetWindow";

/** Widget window: refetch sessions and apply exam payloads from the main window. */
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
        stop = await listen<SessionUpdatedPayload>(
          SESSION_UPDATED_EVENT,
          (event) => {
            void qc.invalidateQueries({ queryKey: ["sessions"] });
            const exams = event.payload?.exams;
            if (!isExamList(exams)) return;
            const current = useUiStore.getState().exams;
            if (JSON.stringify(current) === JSON.stringify(exams)) return;
            useUiStore.getState().setExams(exams);
          },
        );
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

/** Main window: push exam changes, and answer when the widget finishes mounting. */
export function useMainWindowBroadcast() {
  const exams = useUiStore((s) => s.exams);
  const skipMount = useRef(true);

  useEffect(() => {
    if (!isTauri()) return;
    if (skipMount.current) {
      skipMount.current = false;
      return;
    }
    broadcastExams(exams);
  }, [exams]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    try {
      void listen(WIDGET_READY_EVENT, () => {
        broadcastExams(useUiStore.getState().exams);
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
