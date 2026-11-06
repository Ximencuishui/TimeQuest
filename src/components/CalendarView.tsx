import type { TaskSession } from "../types";
import {
  WEEKDAY_LABELS,
  chunkWeeks,
  monthGridDays,
  monthLabel,
  toIsoDate,
} from "../lib/calendar";

const DOT_FALLBACK = "#F97316";
const MAX_DOTS = 3;

type Props = {
  month: Date;
  today: string;
  sessions: TaskSession[];
  selectedDate: string | null;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  /** Clicking today leaves the calendar and opens the day timeline. */
  onOpenDay: (date: string) => void;
  onSelectDate: (date: string | null) => void;
  onCreate: (date: string) => void;
};

function sessionsOn(sessions: TaskSession[], date: string): TaskSession[] {
  return sessions
    .filter((s) => s.date === date)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}

export function CalendarView({
  month,
  today,
  sessions,
  selectedDate,
  onPrevMonth,
  onNextMonth,
  onToday,
  onOpenDay,
  onSelectDate,
  onCreate,
}: Props) {
  const days = monthGridDays(month);
  const weeks = chunkWeeks(days);
  const monthIndex = month.getMonth();

  return (
    <section data-testid="calendar-view">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="上个月"
          className="rounded-lg border border-white/10 bg-surface-2 px-3 py-1.5 text-sm text-ink hover:bg-white/5"
          onClick={onPrevMonth}
        >
          ‹
        </button>
        <h2
          data-testid="calendar-month-label"
          className="min-w-[8.5rem] text-center font-display text-lg"
        >
          {monthLabel(month)}
        </h2>
        <button
          type="button"
          aria-label="下个月"
          className="rounded-lg border border-white/10 bg-surface-2 px-3 py-1.5 text-sm text-ink hover:bg-white/5"
          onClick={onNextMonth}
        >
          ›
        </button>
        <button
          type="button"
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-muted hover:bg-white/5 hover:text-ink"
          onClick={onToday}
        >
          今天
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="pb-1 text-center text-xs text-ink-muted"
          >
            {label}
          </div>
        ))}
        {weeks.map((week) => {
          const weekKey = toIsoDate(week[0]);
          const panelDate =
            selectedDate &&
            selectedDate !== today &&
            week.some((day) => toIsoDate(day) === selectedDate)
              ? selectedDate
              : null;
          const panelSessions = panelDate ? sessionsOn(sessions, panelDate) : [];
          return (
            <div key={weekKey} className="col-span-7 grid grid-cols-7 gap-1">
              {week.map((day) => {
                const iso = toIsoDate(day);
                const inMonth = day.getMonth() === monthIndex;
                const isToday = iso === today;
                const selected = iso === selectedDate;
                const daySessions = sessionsOn(sessions, iso);
                const shown = daySessions.slice(0, MAX_DOTS);
                const extra = daySessions.length - shown.length;
                return (
                  <button
                    key={iso}
                    type="button"
                    data-testid={`calendar-day-${iso}`}
                    data-today={isToday ? "true" : undefined}
                    data-outside={inMonth ? undefined : "true"}
                    data-dot-count={daySessions.length}
                    aria-label={`${iso}，${daySessions.length} 个排期`}
                    aria-pressed={selected}
                    className={[
                      "flex min-h-16 flex-col items-center rounded-lg px-1 py-1.5 text-left",
                      inMonth ? "bg-surface-2" : "bg-surface-2/35 text-zinc-500",
                      selected ? "ring-1 ring-accent" : "",
                      "hover:bg-white/5",
                    ].join(" ")}
                    onClick={() => {
                      if (isToday) {
                        onOpenDay(iso);
                        return;
                      }
                      onSelectDate(selected ? null : iso);
                    }}
                  >
                    <span
                      className={
                        isToday
                          ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs text-white"
                          : "text-xs"
                      }
                    >
                      {day.getDate()}
                    </span>
                    {shown.length > 0 ? (
                      <span className="mt-1 flex items-center gap-0.5">
                        {shown.map((session) => (
                          <span
                            key={session.id}
                            data-testid="calendar-dot"
                            data-color={session.task_color || DOT_FALLBACK}
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              backgroundColor: session.task_color || DOT_FALLBACK,
                            }}
                          />
                        ))}
                        {extra > 0 ? (
                          <span
                            data-testid="calendar-more"
                            className="text-[10px] leading-none text-ink-muted"
                          >
                            +{extra}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}
              {panelDate ? (
                <div
                  data-testid="calendar-day-panel"
                  className="col-span-7 rounded-xl border border-white/10 bg-surface-2 px-3 py-3"
                >
                  <p className="text-sm text-ink">{panelDate} 的排期</p>
                  {panelSessions.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-muted">这一天还没有排期。</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {panelSessions.map((session) => (
                        <li
                          key={session.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{
                              backgroundColor: session.task_color || DOT_FALLBACK,
                            }}
                          />
                          <span className="text-ink-muted">
                            {session.start_time}–{session.end_time}
                          </span>
                          <span>{session.task_title || "未命名任务"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-soft"
                    onClick={() => onCreate(panelDate)}
                  >
                    在这天新建排期
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
