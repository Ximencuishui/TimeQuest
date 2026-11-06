import { pad2 } from "./date";

export const FOCUS_LEAVE_MESSAGE = "正在专注中，确定要离开吗？";

export const DEFAULT_FOCUS_MINUTES = 25;
export const MIN_FOCUS_MINUTES = 1;
export const MAX_FOCUS_MINUTES = 180;

export function formatFocusClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.trunc(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

export function clampFocusMinutes(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_FOCUS_MINUTES;
  return Math.min(
    MAX_FOCUS_MINUTES,
    Math.max(MIN_FOCUS_MINUTES, Math.round(value as number)),
  );
}
