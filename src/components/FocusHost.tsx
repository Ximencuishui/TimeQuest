import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useSessionMutations } from "../hooks/useSessions";
import { FOCUS_START_EVENT } from "../lib/widgetWindow";
import { focusTaskTitle, isFocusSession, useFocusStore } from "../store/focus";
import type { TaskSession } from "../types";
import { CompleteDialog } from "./CompleteDialog";
import { FocusMode } from "./FocusMode";

/** Full-screen focus timer for the main window, plus the completion dialog it opens. */
export function FocusHost() {
  const session = useFocusStore((s) => s.session);
  const stop = useFocusStore((s) => s.stop);
  const [completeTarget, setCompleteTarget] = useState<TaskSession | null>(null);
  const { complete } = useSessionMutations();

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    void listen(FOCUS_START_EVENT, (event) => {
      if (!isFocusSession(event.payload)) return;
      useFocusStore.getState().start(event.payload);
    })
      .then((stopListen) => {
        if (cancelled) stopListen();
        else unlisten = stopListen;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  function openComplete(current: TaskSession) {
    stop();
    setCompleteTarget(current);
  }

  return (
    <>
      {session ? (
        <FocusMode
          title={focusTaskTitle(session)}
          onComplete={() => openComplete(session)}
          onAbandon={stop}
        />
      ) : null}
      <CompleteDialog
        session={completeTarget}
        busy={complete.isPending}
        onClose={() => setCompleteTarget(null)}
        onSubmit={async (data) => {
          if (!completeTarget) return;
          const planned = completeTarget.planned_units;
          const result = await complete.mutateAsync({
            sessionId: completeTarget.id,
            actualUnits: data.actualUnits,
            selfRating: data.selfRating,
            selfNote: data.selfNote || null,
            method: data.method,
            deferRemaining: data.deferRemaining,
            deferDate: data.deferDate,
            deferStart: data.deferStart,
            deferEnd: data.deferEnd,
          });
          if (data.actualUnits <= planned) {
            setCompleteTarget(null);
          }
          return result;
        }}
      />
    </>
  );
}
