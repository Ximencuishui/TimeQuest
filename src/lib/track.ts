import type { Goal, Subject, Track } from "../types";

export { subjectsByKey } from "./subjects";

/**
 * 一条赛道的完整画像：赛道本身 + 它下面的科目 + 它的目标。
 *
 * 4.0 起这三样都落在库里（`tracks` / `subjects` / `goals`），
 * 页面拿这份画像就能渲染出「我在追什么」。
 */
export type TrackProfile = {
  /** 当前赛道。库里一条都没有时是 null。 */
  track: Track | null;
  /** 这条赛道下的科目。 */
  subjects: Subject[];
  /** 这条赛道下的目标（含主目标）。 */
  goals: Goal[];
};

/** 各科目标合计。没有目标分的科目按 0 算。 */
export function trackSubjectTotal(subjects: Subject[]): number {
  return subjects.reduce((sum, subject) => sum + (subject.goal ?? 0), 0);
}

/**
 * 找这条赛道下的目标。
 *
 * 优先用归属这条赛道的目标；没有就退回主目标，再没有就取第一条。
 */
export function resolveGoalForTrack(
  goals: Goal[],
  trackId: number | null,
): Goal | null {
  if (trackId != null) {
    const scoped = goals.find((goal) => goal.trackId === trackId);
    if (scoped) return scoped;
  }
  return goals.find((goal) => goal.isPrimary) ?? goals[0] ?? null;
}
