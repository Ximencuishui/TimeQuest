import { useEffect, useState } from "react";
import { computeCountdown, pad2 } from "../lib/date";
import { useUiStore } from "../store/ui";

export function CountdownPanel() {
  const exams = useUiStore((s) => s.exams);
  const primary = exams.find((e) => e.isPrimary) ?? exams[0];
  const targetDate = primary?.date;
  const [now, setNow] = useState(() => new Date());

  // Recreate when primary exam date changes so the prior interval is cleared
  // (avoids a leaked timer if the effect body later depends on targetDate).
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [targetDate]);

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
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
          <span>{c.weeks} 周</span>
          <span>{c.months} 月</span>
          <span className="font-mono text-lg text-ink">
            {pad2(c.hours)}:{pad2(c.minutes)}:{pad2(c.seconds)}
          </span>
        </div>
        <p className="mt-3 text-xs text-ink-muted">目标日 {primary.date}</p>
      </div>
    </section>
  );
}
