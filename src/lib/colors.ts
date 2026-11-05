import type { NoteColor } from "./constants";

export const NOTE_COLOR_CLASSES: Record<
  NoteColor,
  { bg: string; border: string; text: string }
> = {
  yellow: {
    bg: "bg-amber-200",
    border: "border-amber-400",
    text: "text-amber-950",
  },
  orange: {
    bg: "bg-orange-200",
    border: "border-orange-400",
    text: "text-orange-950",
  },
  green: {
    bg: "bg-emerald-200",
    border: "border-emerald-400",
    text: "text-emerald-950",
  },
  blue: {
    bg: "bg-sky-200",
    border: "border-sky-400",
    text: "text-sky-950",
  },
  pink: {
    bg: "bg-pink-200",
    border: "border-pink-400",
    text: "text-pink-950",
  },
  purple: {
    bg: "bg-violet-200",
    border: "border-violet-400",
    text: "text-violet-950",
  },
};

export const TASK_PALETTE = [
  "#F97316",
  "#14B8A6",
  "#3B82F6",
  "#EC4899",
  "#84CC16",
  "#EAB308",
  "#8B5CF6",
  "#EF4444",
];

export function sessionsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
