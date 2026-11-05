import { ComboMeter } from "questro/combo";
import { levelFromTotalXp, streakMultiplier } from "../lib/gamification";
import { useUserStats } from "../hooks/useStats";

export function StatusBar() {
  const { data: stats } = useUserStats();
  if (!stats) {
    return (
      <div className="rounded-xl border border-white/5 bg-surface-2/80 px-4 py-3 text-sm text-ink-muted">
        等级与连击加载中…
      </div>
    );
  }

  const levelInfo = levelFromTotalXp(stats.total_xp);
  const mult = streakMultiplier(stats.current_streak);

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-white/5 bg-surface-2/80 px-4 py-3">
      <div>
        <div className="text-xs text-ink-muted">等级</div>
        <div className="font-display text-lg text-accent-soft">
          Lv.{stats.current_level}
        </div>
      </div>
      <div className="min-w-[120px] flex-1">
        <div className="mb-1 flex justify-between text-xs text-ink-muted">
          <span>XP {stats.total_xp}</span>
          <span>
            {levelInfo.xpIntoLevel}/{levelInfo.xpForNext}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-accent"
            style={{
              width: `${Math.min(
                100,
                (levelInfo.xpIntoLevel / levelInfo.xpForNext) * 100,
              )}%`,
            }}
          />
        </div>
      </div>
      <div className="text-sm">
        <span className="text-ink-muted">连击 </span>
        <span className="text-ink">{stats.current_streak}</span>
        <span className="text-ink-muted"> 天 · 最长 </span>
        <span className="text-ink">{stats.longest_streak}</span>
      </div>
      <ComboMeter
        combo={stats.current_streak}
        multiplier={mult}
        isActive={stats.current_streak > 0}
        timeRemaining={0}
      />
    </div>
  );
}
