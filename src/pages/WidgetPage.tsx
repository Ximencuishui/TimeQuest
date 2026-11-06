import { useEffect, useState } from "react";
import { useSessionsByDate } from "../hooks/useSessions";
import { computeCountdown, pad2, todayStr } from "../lib/date";
import { findScrollTargetSession, sessionTimePhase } from "../lib/sessionTime";
import { hideWidgetWindow } from "../lib/widgetWindow";
import { useUiStore } from "../store/ui";

export function WidgetPage() {
  const exams = useUiStore((s) => s.exams);
  const primary = exams.find((e) => e.isPrimary) ?? exams[0];
  const targetDate = primary?.date;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [targetDate]);

  const today = todayStr(now);
  const { data: sessions = [], isLoading } = useSessionsByDate(today);
  const focus = findScrollTargetSession(sessions, now);
  const phase = focus
    ? sessionTimePhase(focus.start_time, focus.end_time, now)
    : null;
  const phaseLabel = phase === "active" ? "进行中" : focus ? "下一场" : null;
  const countdown = primary ? computeCountdown(primary.date, now) : null;

  return (
    <div className="h-full w-full bg-transparent p-1.5">
      <section
        data-tauri-drag-region
        className="relative flex h-full flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 shadow-2xl backdrop-blur-md select-none"
      >
        <button
          type="button"
          aria-label="关闭悬浮窗"
          className="absolute top-1.5 right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => void hideWidgetWindow()}
        >
          ×
        </button>

        {primary && countdown ? (
          <div data-tauri-drag-region className="min-w-0 pr-5">
            <p data-tauri-drag-region className="truncate text-xs text-zinc-400">
              距离 {primary.name}
            </p>
            <p
              data-testid="widget-countdown-days"
              data-tauri-drag-region
              className="font-mono text-5xl leading-none font-semibold tracking-tight text-orange-400 tabular-nums"
            >
              {countdown.isPast ? "已到达" : countdown.days}
              {countdown.isPast ? null : (
                <span className="ml-1 text-sm font-normal text-zinc-400">天</span>
              )}
            </p>
            <p
              data-tauri-drag-region
              className="mt-1 font-mono text-sm text-zinc-200 tabular-nums"
            >
              {pad2(countdown.hours)}:{pad2(countdown.minutes)}:
              {pad2(countdown.seconds)}
            </p>
          </div>
        ) : (
          <p data-tauri-drag-region className="pr-5 text-xs text-zinc-400">
            请先在设置中添加考试目标日期
          </p>
        )}

        <p
          data-testid="widget-session"
          data-tauri-drag-region
          className="mt-auto truncate pt-2 text-xs text-zinc-300"
        >
          {isLoading ? (
            "加载中…"
          ) : focus && phaseLabel ? (
            <>
              <span className="text-orange-400">{phaseLabel}</span>
              <span className="ml-1 font-mono">
                {focus.start_time}–{focus.end_time}
              </span>
              <span className="ml-1">{focus.task_title ?? "未命名任务"}</span>
            </>
          ) : (
            "今天没有待完成的排期"
          )}
        </p>
      </section>
    </div>
  );
}
