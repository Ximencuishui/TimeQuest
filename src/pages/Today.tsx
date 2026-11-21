import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { startOfMonth } from "date-fns";
import { CalendarView } from "../components/CalendarView";
import { DateField } from "../components/DateField";
import { DayNotes } from "../components/DayNotes";
import { KnowledgePointDrawer, type KnowledgeTask } from "../components/KnowledgePointDrawer";
import { CompleteDialog } from "../components/CompleteDialog";
import { RescheduleDialog } from "../components/RescheduleDialog";
import { Modal } from "../components/Modal";
import { TimeRangeField } from "../components/TimeRangeField";
import { TodayTimeline } from "../components/TodayTimeline";
import { useCurrentTime } from "../hooks/useCurrentTime";
import { useNotes } from "../hooks/useNotes";
import { useTasks } from "../hooks/useTasks";
import {
  useSessionMutations,
  useSessionsByDate,
  useSessionsInRange,
} from "../hooks/useSessions";
import { gridRange, parseLocalDate, shiftMonth } from "../lib/calendar";
import { sessionsOverlap } from "../lib/colors";
import { todayStr } from "../lib/date";
import { notesOnDate } from "../lib/notes";
import { roundName } from "../lib/rounds";
import { timeRangeError } from "../lib/sessionTime";
import { unitNameOf } from "../lib/units";
import { api } from "../api/tauri";
import { useFocusStore } from "../store/focus";
import type { TaskSession } from "../types";

type TodayView = "day" | "calendar";

export function TodayRoute() {
  const location = useLocation();
  return <Today focusSessionId={focusSessionIdFrom(location.state)} />;
}

function focusSessionIdFrom(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const id = (state as { focusSessionId?: unknown }).focusSessionId;
  return typeof id === "number" ? id : null;
}

export function Today({ focusSessionId = null }: { focusSessionId?: number | null }) {
  const now = useCurrentTime(30_000);
  const [view, setView] = useState<TodayView>("day");
  const [date, setDate] = useState(() => todayStr());
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { data: sessions = [], isLoading } = useSessionsByDate(date);
  const range = useMemo(() => gridRange(month), [month]);
  const { data: rangeSessions = [], isError: rangeError } = useSessionsInRange(
    range.start,
    range.end,
    view === "calendar",
  );
  const { data: tasks = [] } = useTasks(false);
  const { data: allNotes } = useNotes();
  const { create, complete, reschedule, remove } = useSessionMutations();
  const startFocus = useFocusStore((s) => s.start);
  const isViewingToday = date === todayStr(now);

  const dayNotes = useMemo(
    () => notesOnDate(allNotes ?? [], date),
    [allNotes, date],
  );

  const [completeTarget, setCompleteTarget] = useState<TaskSession | null>(null);
  const [knowledgeTask, setKnowledgeTask] = useState<KnowledgeTask | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<TaskSession | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    taskId: 0,
    date: todayStr(),
    startTime: "09:00",
    endTime: "10:00",
    plannedUnits: 2,
    round: 1,
  });
  const [conflictPrompt, setConflictPrompt] = useState<TaskSession[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskSession | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const conflicts = useMemo(() => {
    const planned = sessions.filter((s) => s.status === "planned");
    const ids = new Set<number>();
    for (let i = 0; i < planned.length; i++) {
      for (let j = i + 1; j < planned.length; j++) {
        if (
          sessionsOverlap(
            planned[i].start_time,
            planned[i].end_time,
            planned[j].start_time,
            planned[j].end_time,
          )
        ) {
          ids.add(planned[i].id);
          ids.add(planned[j].id);
        }
      }
    }
    return ids;
  }, [sessions]);

  const sorted = useMemo(
    () => [...sessions].sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [sessions],
  );

  const openCreate = (day?: string) => {
    const first = tasks[0];
    setForm({
      taskId: first?.id ?? 0,
      date: day ?? date,
      startTime: "09:00",
      endTime: "10:00",
      plannedUnits: 2,
      round: first?.current_round ?? 1,
    });
    setActionError(null);
    setCreateOpen(true);
  };

  const openCreateOn = (day: string) => {
    setDate(day);
    openCreate(day);
  };

  const createTimeError = timeRangeError(form.startTime, form.endTime);

  async function doCreate() {
    await create.mutateAsync({
      taskId: form.taskId,
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime,
      round: form.round,
      plannedUnits: selectedTask?.type === "side" ? 0 : form.plannedUnits,
    });
    setCreateOpen(false);
    setConflictPrompt(null);
    setDate(form.date);
  }

  /** 防呆：保存前先查冲突，冲突时先问一句，而不是存完再挂横幅。 */
  async function submitCreate() {
    if (createTimeError) return;
    setActionError(null);
    try {
      const overlaps = await api.findOverlaps(
        form.date,
        form.startTime,
        form.endTime,
      );
      if (overlaps.length > 0) {
        setConflictPrompt(overlaps);
        return;
      }
      await doCreate();
    } catch (cause) {
      setActionError(String(cause));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setActionError(null);
    try {
      await remove.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (cause) {
      setActionError(String(cause));
      setDeleteTarget(null);
    }
  }

  const showCalendar = () => {
    const parsed = parseLocalDate(date);
    setMonth(startOfMonth(Number.isNaN(parsed.getTime()) ? now : parsed));
    setSelectedDate(null);
    setView("calendar");
  };

  const selectedTask = tasks.find((t) => t.id === form.taskId);
  const selectedUnit = unitNameOf(
    selectedTask ? { task_unit_name: selectedTask.unit_name } : null,
  );

  const today = todayStr(now);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 inline-flex rounded-lg border border-white/10 bg-surface-2 p-0.5">
        <button
          type="button"
          aria-pressed={view === "day"}
          className={`rounded-md px-3 py-1.5 text-sm ${
            view === "day" ? "bg-accent text-white" : "text-ink-muted"
          }`}
          onClick={() => setView("day")}
        >
          日视图
        </button>
        <button
          type="button"
          aria-pressed={view === "calendar"}
          className={`rounded-md px-3 py-1.5 text-sm ${
            view === "calendar" ? "bg-accent text-white" : "text-ink-muted"
          }`}
          onClick={showCalendar}
        >
          日历视图
        </button>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">
          {view === "calendar" ? "日历" : "今日计划"}
        </h1>
        {view === "day" ? (
          <div className="flex items-center gap-2">
            <DateField label="日期" value={date} onChange={setDate} />
            <button
              type="button"
              className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent-soft"
              onClick={() => openCreate()}
            >
              新建排期
            </button>
          </div>
        ) : null}
      </div>

      {view === "calendar" ? (
        <>
          {rangeError ? (
            <p className="mb-3 text-sm text-amber-200">排期加载失败，日历仍可浏览。</p>
          ) : null}
          <CalendarView
            month={month}
            today={today}
            sessions={rangeSessions}
            selectedDate={selectedDate}
            onPrevMonth={() => {
              setMonth((current) => shiftMonth(current, -1));
              setSelectedDate(null);
            }}
            onNextMonth={() => {
              setMonth((current) => shiftMonth(current, 1));
              setSelectedDate(null);
            }}
            onToday={() => {
              setMonth(startOfMonth(now));
              setSelectedDate(null);
            }}
            onOpenDay={(iso) => {
              setDate(iso);
              setSelectedDate(null);
              setView("day");
            }}
            onSelectDate={setSelectedDate}
            onCreate={openCreateOn}
          />
        </>
      ) : (
        <>
          {conflicts.size > 0 ? (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              有 {conflicts.size} 个排期时段重叠（仅提示，不阻止保存）。
            </div>
          ) : null}

          {isLoading ? (
            <p className="text-ink-muted">加载中…</p>
          ) : sorted.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center">
              <p className="text-ink-muted">这一天还没有排期。</p>
              <button
                type="button"
                className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm text-white"
                onClick={() => openCreate()}
              >
                创建第一个排期
              </button>
            </div>
          ) : (
            <TodayTimeline
              sessions={sorted}
              now={now}
              timeAware={isViewingToday}
              scrollToSessionId={focusSessionId}
              onComplete={setCompleteTarget}
              onReschedule={setRescheduleTarget}
              onDelete={setDeleteTarget}
              onFocus={startFocus}
              onOpenKnowledge={(session) =>
                setKnowledgeTask({
                  id: session.task_id,
                  title: session.task_title ?? "主线",
                })
              }
            />
          )}

          <DayNotes notes={dayNotes} />
        </>
      )}

      <KnowledgePointDrawer task={knowledgeTask} onClose={() => setKnowledgeTask(null)} />

      <Modal
        open={createOpen}
        title="新建排期"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-ink-muted"
              onClick={() => setCreateOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-50"
              disabled={
                !form.taskId || create.isPending || createTimeError != null
              }
              onClick={() => void submitCreate()}
            >
              创建
            </button>
          </>
        }
      >
        {tasks.length === 0 ? (
          <p className="text-sm text-ink-muted">请先创建任务。</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="block">
              <span className="text-ink-muted">日期</span>
              <div className="mt-1">
                <DateField
                  label="日期"
                  value={form.date}
                  onChange={(value) => setForm({ ...form, date: value })}
                />
              </div>
            </div>
            <label className="block">
              <span className="text-ink-muted">任务</span>
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
                value={form.taskId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  const t = tasks.find((x) => x.id === id);
                  setForm({
                    ...form,
                    taskId: id,
                    round: t?.current_round ?? 1,
                  });
                }}
              >
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.type === "main" ? "[主]" : "[副]"} {t.title}
                  </option>
                ))}
              </select>
            </label>
            <TimeRangeField
              start={form.startTime}
              end={form.endTime}
              onChange={(startTime, endTime) =>
                setForm({ ...form, startTime, endTime })
              }
            />
            {createTimeError ? (
              <p className="text-sm text-amber-200" role="alert">
                {createTimeError}
              </p>
            ) : null}
            {selectedTask?.type === "main" ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-ink-muted">轮次</span>
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
                    value={form.round}
                    onChange={(e) =>
                      setForm({ ...form, round: Number(e.target.value) })
                    }
                  />
                  {/* 轮次编号对用户没意义，直接告诉他这一场算哪一轮。 */}
                  <span className="mt-1 block text-[11px] text-ink-muted/70">
                    这一场算作：{roundName(form.round)}
                  </span>
                </label>
                <label className="block">
                  <span className="text-ink-muted">计划{selectedUnit}数</span>
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
                    value={form.plannedUnits}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        plannedUnits: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <Modal
        open={conflictPrompt != null}
        title="时段重叠"
        onClose={() => setConflictPrompt(null)}
        footer={
          <>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-ink-muted hover:bg-white/5"
              onClick={() => setConflictPrompt(null)}
            >
              改时间
            </button>
            <button
              type="button"
              className="rounded-lg bg-accent px-4 py-2 text-white"
              onClick={() => void doCreate()}
            >
              仍然保存
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          这个时间段和下面 {conflictPrompt?.length ?? 0} 条排期重叠。要保存吗？
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {(conflictPrompt ?? []).map((item) => (
            <li key={item.id} className="text-ink-muted">
              {item.task_title ?? `任务 #${item.task_id}`} · {item.start_time} –{" "}
              {item.end_time}
            </li>
          ))}
        </ul>
      </Modal>

      <Modal
        open={deleteTarget != null}
        title="删除这条排期？"
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-ink-muted hover:bg-white/5"
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-50"
              disabled={remove.isPending}
              onClick={() => void confirmDelete()}
            >
              删除
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          {deleteTarget
            ? `${deleteTarget.task_title ?? "这条排期"} · ${deleteTarget.start_time} – ${deleteTarget.end_time}`
            : ""}
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          删除后不再出现在今日计划里。已经完成、有学习记录的排期不能删。
        </p>
        {actionError ? (
          <p className="mt-2 text-sm text-amber-200" role="alert">
            {actionError}
          </p>
        ) : null}
      </Modal>

      <CompleteDialog
        session={completeTarget}
        busy={complete.isPending}
        onClose={() => setCompleteTarget(null)}
        onSubmit={async (data) => {
          if (!completeTarget) return;
          const planned = completeTarget.planned_units;
          const result = await complete.mutateAsync({
            sessionId: completeTarget.id,
            actualUnits: data.actualUnits,
            selfRating: data.selfRating,
            selfNote: data.selfNote || null,
            method: data.method,
            deferRemaining: data.deferRemaining,
            deferDate: data.deferDate,
            deferStart: data.deferStart,
            deferEnd: data.deferEnd,
          });
          // 超额时留下弹窗，让成功提示留在屏幕上；满额和部分完成仍直接关掉。
          if (data.actualUnits <= planned) {
            setCompleteTarget(null);
          }
          return result;
        }}
      />

      <RescheduleDialog
        session={rescheduleTarget}
        busy={reschedule.isPending}
        onClose={() => setRescheduleTarget(null)}
        onSubmit={async (data) => {
          if (!rescheduleTarget) return;
          await reschedule.mutateAsync({
            sessionId: rescheduleTarget.id,
            date: data.date,
            startTime: data.startTime,
            endTime: data.endTime,
          });
          setRescheduleTarget(null);
        }}
      />
    </div>
  );
}
