import { Link } from "react-router-dom";
import { useExamRecords } from "../hooks/useExamRecords";
import { useUserProfile } from "../hooks/useUserProfile";
import { buildScoreOverview, type ScoreOverview } from "../lib/scoreOverview";
import type { ExamRecord } from "../types";

const GAP_CLASS = {
  above: "bg-green-500/20 text-green-400",
  below: "bg-orange-500/20 text-orange-400",
} as const;

export function ScoreOverviewCapsule({
  records,
  totalTarget,
}: {
  records: ExamRecord[];
  totalTarget: number | null;
}) {
  const overview = buildScoreOverview(records, totalTarget);
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
  if (overview.kind === "partial") {
    return (
      <>
        <span className="text-ink-muted">最近成绩：</span>
        <span className="font-display tabular-nums">{overview.sum}</span>
        <span className="text-xs text-ink-muted">{overview.count} 科</span>
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
  const { data: records } = useExamRecords();
  const { data: profile } = useUserProfile();
  return (
    <ScoreOverviewCapsule
      records={records ?? []}
      totalTarget={profile ? profile.total_target : null}
    />
  );
}
