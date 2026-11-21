import { useMemo, useState } from "react";
import { startOfMonth } from "date-fns";
import {
  WEEKDAY_LABELS,
  chunkWeeks,
  monthGridDays,
  monthLabel,
  shiftMonth,
  toIsoDate,
} from "../lib/calendar";
import type { Task, TaskSession } from "../types";

const DOT_FALLBACK = "#F97316";
/** 一格里最多画几条排期，剩下的只给数字。 */
const MAX_CHIPS = 2;

type Props = {
  tasks: Task[];
  sessions: TaskSession[];
  today: string;
};

/**
 * 总计划的日历视图：一个月里每天排了什么，一眼看到密度。
 *
 * 和「今日」页的日历不同，这里是看整月的计划分布，不做单日管理，
 * 所以只读，不提供「在这天新建排期」。
 */
export function PlanCalendarView({ tasks, sessions, today }: Props) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<string | null>(null);

  const byDate = useMemo(() => {
    const map = new Map<string, TaskSession[]>();
    for (const session of sessions) {
      const list = map.get(session.date) ?? [];
      list.push(session);
      map.set(session.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    }
    return map;
  }, [sessions]);

  const days = monthGridDays(month);
  const weeks = chunkWeeks(days);
  const monthIndex = month.getMonth();
  const selectedSessions = selected ? (byDate.get(selected) ?? []) : [];

  if (tasks.length === 0) {
    return (
      <EmptyPlan
        text="当前筛选下没有任务，换个标签或先建一条主线。"
      />
    );
  }

  return (
    <section data-testid="plan-calendar-view" aria-label="总计划日历">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="上个月"
          className="rounded-lg border border-white/10 bg-surface-2 px-3 py-1.5 text-sm text-ink hover:bg-white/5"
          onClick={() => setMonth((current) => shiftMonth(current, -1))}
        >
          ‹
        </button>
        <h3 className="min-w-[8.5rem] text-center font-display text-lg">
          {monthLabel(month)}
        </h3>
        <button
          type="button"
          aria-label="下个月"
          className="rounded-lg border border-white/10 bg-surface-2 px-3 py-1.5 text-sm text-ink hover:bg-white/5"
          onClick={() => setMonth((current) => shiftMonth(current, 1))}
        >
          ›
        </button>
        <button
          type="button"
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-muted hover:bg-white/5 hover:text-ink"
          onClick={() => {
            setMonth(startOfMonth(new Date()));
            setSelected(null);
          }}
        >
          回到本月
        </button>
        <p className="ml-auto text-[11px] text-ink-muted">
          颜色 = 任务色，点一天看当天排期。
        </p>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="pb-1 text-center text-xs text-ink-muted">
            {label}
          </div>
        ))}
        {weeks.map((week) => (
          <div key={toIsoDate(week[0])} className="col-span-7 grid grid-cols-7 gap-1">
            {week.map((day) => {
              const iso = toIsoDate(day);
              const inMonth = day.getMonth() === monthIndex;
              const isToday = iso === today;
              const isSelected = iso === selected;
              const daySessions = byDate.get(iso) ?? [];
              const shown = daySessions.slice(0, MAX_CHIPS);
              const extra = daySessions.length - shown.length;
              const plannedUnits = daySessions.reduce(
                (sum, session) => sum + (session.planned_units ?? 0),
                0,
              );
              return (
                <button
                  key={iso}
                  type="button"
                  data-testid={`plan-calendar-day-${iso}`}
                  data-today={isToday ? "true" : undefined}
                  aria-pressed={isSelected}
                  className={[
                    "flex min-h-20 flex-col items-start gap-1 rounded-lg px-1.5 py-1.5 text-left transition",
                    inMonth ? "bg-surface-2" : "bg-surface-2/35 text-zinc-500",
                    isSelected ? "ring-1 ring-accent" : "",
                    "hover:bg-white/5",
                  ].join(" ")}
                  onClick={() => setSelected(isSelected ? null : iso)}
                >
                  <span
                    className={
                      isToday
                        ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] text-white"
                        : "text-xs"
                    }
                  >
                    {day.getDate()}
                  </span>
                  {shown.map((session) => (
                    <span
                      key={session.id}
                      className="w-full truncate rounded px-1 py-0.5 text-[10px] leading-tight text-zinc-200"
                      style={{
                        backgroundColor: `${session.task_color || DOT_FALLBACK}33`,
                        borderLeft: `2px solid ${session.task_color || DOT_FALLBACK}`,
                      }}
                    >
                      {session.start_time} {session.task_title || "排期"}
                    </span>
                  ))}
                  {extra > 0 ? (
                    <span className="text-[10px] text-ink-muted">+{extra} 场</span>
                  ) : null}
                  {plannedUnits > 0 && shown.length === 0 && extra === 0 ? (
                    <span className="text-[10px] text-ink-muted">计划 {plannedUnits}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {selected ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-surface-2 px-3 py-3">
          <p className="text-sm text-ink">{selected} 的排期</p>
          {selectedSessions.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">这一天还没有排期。</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {selectedSessions.map((session) => (
                <li key={session.id} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: session.task_color || DOT_FALLBACK,
                    }}
                  />
                  <span className="text-ink-muted">
                    {session.start_time}–{session.end_time}
                  </span>
                  <span className="truncate">
                    {session.task_title || "未命名任务"}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-ink-muted">
                    第{session.round}轮 · {session.status === "done" ? "已完成" : session.status === "missed" ? "已错过" : "待完成"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function EmptyPlan({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-ink-muted">
      {text}
    </p>
  );
}
