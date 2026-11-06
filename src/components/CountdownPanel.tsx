import { useRemainingStudyTime } from "../hooks/useRemainingStudyTime";
import { computeCountdown } from "../lib/date";
import { useUiStore } from "../store/ui";
import { StudyRemaining } from "./StudyRemaining";

export function CountdownPanel() {
  const exams = useUiStore((s) => s.exams);
  const primary = exams.find((e) => e.isPrimary) ?? exams[0];
  const { now, pending, study } = useRemainingStudyTime();

  if (!primary) {
    return (
      <div className="rounded-2xl bg-surface-2 p-6 text-ink-muted">
        请先在设置中添加考试目标日期
      </div>
    );
  }

  const c = computeCountdown(primary.date, now);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/5 bg-surface-2/90 p-6 shadow-xl shadow-black/20">
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-30 blur-3xl"
        style={{ background: "var(--color-accent)" }}
      />
      <div className="relative">
        <p className="text-sm text-ink-muted">距离 {primary.name}</p>
        <p className="mt-1 font-display text-5xl tracking-tight text-ink md:text-6xl">
          {c.isPast ? "已到达" : (
            <>
              <span className="text-accent-soft">{c.days}</span>
              <span className="ml-2 text-2xl text-ink-muted md:text-3xl">天</span>
            </>
          )}
        </p>
        <div className="mt-4 flex flex-wrap items-baseline gap-4 text-sm text-ink-muted">
          <span>{c.weeks} 周</span>
          <span>{c.months} 月</span>
          <StudyRemaining study={study} pending={pending} />
        </div>
        <p className="mt-3 text-xs text-ink-muted">目标日 {primary.date}</p>
      </div>
    </section>
  );
}
