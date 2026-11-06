import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useUiStore } from "../store/ui";
import type { ExamTarget } from "../types";

export const MAIN_LABEL = "main";
export const WIDGET_LABEL = "widget";

/** Broadcast when sessions change. Payload may also carry the exam list. */
export const SESSION_UPDATED_EVENT = "session-updated";
/** Widget asks the main window for the current exam list after it mounts. */
export const WIDGET_READY_EVENT = "widget-ready";
/** Keep the dashboard switch aligned when the widget hides itself. */
export const WIDGET_VISIBILITY_EVENT = "widget-visibility";

export type SessionUpdatedPayload = {
  exams?: ExamTarget[];
};

export function readWindowLabel(): string {
  if (!isTauri()) return MAIN_LABEL;
  try {
    return getCurrentWindow().label || MAIN_LABEL;
  } catch {
    return MAIN_LABEL;
  }
}

export function isExamList(value: unknown): value is ExamTarget[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      !!item &&
      typeof item === "object" &&
      typeof (item as ExamTarget).id === "string" &&
      typeof (item as ExamTarget).name === "string" &&
      typeof (item as ExamTarget).date === "string" &&
      typeof (item as ExamTarget).isPrimary === "boolean",
  );
}

function emitQuiet(event: string, payload?: unknown): void {
  if (!isTauri()) return;
  try {
    void emit(event, payload).catch(() => undefined);
  } catch {
    /* event API missing outside a Tauri webview */
  }
}

export function broadcastSessionUpdated(): void {
  emitQuiet(SESSION_UPDATED_EVENT, {});
}

export function broadcastExams(exams: ExamTarget[]): void {
  emitQuiet(SESSION_UPDATED_EVENT, { exams } satisfies SessionUpdatedPayload);
}

function widgetOptions() {
  return {
    title: "TimeQuest Widget",
    url: "index.html",
    width: 300,
    height: 200,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    visible: true,
    focus: true,
    shadow: false,
    noRedirectionBitmap: true,
  };
}

function waitForWidget(win: WebviewWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    void win.once("tauri://created", () => resolve());
    void win.once("tauri://error", (event) => {
      const reason = event.payload;
      reject(reason instanceof Error ? reason : new Error(String(reason)));
    });
  });
}

/**
 * Show or hide the desktop widget.
 * The config window starts hidden. If the user destroyed it, create it again
 * with the same label so the switch can bring it back.
 */
export async function setWidgetVisible(visible: boolean): Promise<void> {
  if (!isTauri()) return;
  let win = await WebviewWindow.getByLabel(WIDGET_LABEL);
  if (!win && visible) {
    const created = new WebviewWindow(WIDGET_LABEL, widgetOptions());
    try {
      await waitForWidget(created);
      win = created;
    } catch {
      win = await WebviewWindow.getByLabel(WIDGET_LABEL);
      if (!win) throw new Error("widget window failed to open");
    }
  }
  if (!win) return;
  if (visible) {
    await win.show();
    await win.setAlwaysOnTop(true);
    broadcastExams(useUiStore.getState().exams);
  } else {
    await win.hide();
  }
  emitQuiet(WIDGET_VISIBILITY_EVENT, { visible });
}

export async function hideWidgetWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    await getCurrentWindow().hide();
  } catch {
    return;
  }
  emitQuiet(WIDGET_VISIBILITY_EVENT, { visible: false });
}
