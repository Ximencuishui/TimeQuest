import { create } from "zustand";
import type { TaskSession } from "../types";

type FocusState = {
  session: TaskSession | null;
  /** Ignore a second start while a timer is already on screen. */
  start: (session: TaskSession) => void;
  stop: () => void;
};

export const useFocusStore = create<FocusState>((set) => ({
  session: null,
  start: (session) => {
    if (session.status !== "planned") return;
    set((state) => (state.session ? state : { session }));
  },
  stop: () => set({ session: null }),
}));

export function isFocusSession(value: unknown): value is TaskSession {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<TaskSession>;
  return (
    typeof row.id === "number" &&
    typeof row.task_id === "number" &&
    typeof row.date === "string" &&
    typeof row.start_time === "string" &&
    typeof row.end_time === "string" &&
    row.status === "planned" &&
    typeof row.planned_units === "number"
  );
}

export function focusTaskTitle(
  session: Pick<TaskSession, "task_title" | "task_id" | "subject">,
): string {
  const title = session.task_title?.trim() || `任务 #${session.task_id}`;
  const subject = session.subject?.trim();
  if (!subject || title.includes(subject)) return title;
  return `${subject} · ${title}`;
}
