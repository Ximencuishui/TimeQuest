import { Link } from "react-router-dom";
import { useExamSessions } from "../hooks/useExamSessions";
import { useGoals } from "../hooks/useGoals";
import { useSubjects } from "../hooks/useSubjects";
import { useActiveTrack } from "../hooks/useTracks";
import { resolvePrimaryGoal } from "../lib/goals";
import { buildScoreOverview, type ScoreOverview } from "../lib/scoreOverview";
import type { ExamSession, Subject } from "../types";

const GAP_CLASS = {
  above: "bg-green-500/20 text-green-400",
  below: "bg-orange-500/20 text-orange-400",
} as const;

export function ScoreOverviewCapsule({
  sessions,
  subjects,
  totalTarget,
}: {
  sessions: ExamSession[];
  subjects: Subject[];
  totalTarget: number | null;
}) {
  const overview = buildScoreOverview(sessions, totalTarget, subjects);
  if (!overview) return null;
  return (
    <Link
      to="/scores"
      className="inline-flex max-w-full items-center gap-2 self-end rounded-full border border-white/10 bg-surface-2/80 px-3 py-1 text-sm text-ink hover:border-white/20"
    >
      <CapsuleBody overview={overview} />
    </Link>
  );
}

function CapsuleBody({ overview }: { overview: ScoreOverview }) {
  if (overview.kind === "single") {
    return (
      <>
        <span className="text-ink-muted">最近单科：</span>
        <span className="font-display tabular-nums">
          {overview.subject} {overview.score}
        </span>
      </>
    );
  }
  if (overview.kind === "scaled") {
    return (
      <>
        <span className="text-ink-muted">最近成绩：</span>
        <span className="font-display tabular-nums">{overview.score}</span>
        <span className="text-xs text-ink-muted">
          {overview.missing.length > 0
            ? `折算 · 缺考${overview.missing.join("、")}`
            : `${overview.count} 科`}
        </span>
        {overview.gap && overview.tone ? (
          <span className={`rounded-full px-2 py-0.5 text-xs ${GAP_CLASS[overview.tone]}`}>
            {overview.gap}
          </span>
        ) : null}
      </>
    );
  }
  return (
    <>
      <span className="text-ink-muted">最近成绩：</span>
      <span className="font-display tabular-nums">{overview.score}</span>
      {overview.gap && overview.tone ? (
        <span className={`rounded-full px-2 py-0.5 text-xs ${GAP_CLASS[overview.tone]}`}>
          {overview.gap}
        </span>
      ) : null}
    </>
  );
}

export function DashboardScoreOverview() {
  const { data: sessions } = useExamSessions();
  // 科目跟着当前赛道走：换赛道就是换一套科目。
  const { trackId: activeTrackId } = useActiveTrack();
  const { data: subjects } = useSubjects(activeTrackId);
  const { data: goals = [] } = useGoals();
  // 总分目标跟着主目标走：它落在 `goals.target_score`，不再从旧档案读。
  const primaryGoal = resolvePrimaryGoal(goals);
  const totalTarget = primaryGoal?.targetScore ?? null;
  return (
    <ScoreOverviewCapsule
      sessions={sessions ?? []}
      subjects={subjects ?? []}
      totalTarget={totalTarget}
    />
  );
}
