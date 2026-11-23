import { useGoals } from "../hooks/useGoals";
import { todayStr } from "../lib/date";
import { nextMockGoal } from "../lib/goals";

/**
 * 模考倒计时：下一次模考还有多少天。
 *
 * 主目标动辄几百天，学生容易失去紧迫感；模考是最近的抓手。
 * 没有设置模考时不显示（去设置里加一条「名称（如模考）+ 日期」即可）。
 */
export function MockCountdown() {
  const { data: goals = [] } = useGoals();
  const mock = nextMockGoal(goals, todayStr());
  if (!mock) return null;

  return (
    <section
      data-testid="mock-countdown"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/5 bg-surface-2/80 px-4 py-3"
    >
      <span className="text-sm text-ink-muted">距离 {mock.name}</span>
      <span className="font-display text-lg text-accent-soft">
        {mock.isToday ? "就是今天" : `${mock.daysLeft} 天`}
      </span>
      <span className="text-xs text-ink-muted">目标日 {mock.date}</span>
    </section>
  );
}