import { useEffect, useMemo, useState, type ReactNode } from "react";
import { KnowledgePointDrawer, type KnowledgeTask } from "../components/KnowledgePointDrawer";
import { PlanCalendarView } from "../components/PlanCalendarView";
import { PlanFishboneView } from "../components/PlanFishboneView";
import { PlanFilterBar } from "../components/PlanFilterBar";
import { PlanGanttView } from "../components/PlanGanttView";
import { RecycleBin } from "../components/RecycleBin";
import { TaskGridView } from "../components/TaskGridView";
import { TaskListView } from "../components/TaskListView";
import { TaskFormModal, type TaskFormValues } from "../components/TaskFormModal";
import { TextbookImportWizard } from "../components/TextbookImportWizard";
import { useCurrentTime } from "../hooks/useCurrentTime";
import { useSessionsInRange } from "../hooks/useSessions";
import { useTaskMutations, useTasks } from "../hooks/useTasks";
import { toIsoDate } from "../lib/calendar";
import { formatMonthDay } from "../lib/date";
import {
  collectPlanTags,
  emptyPlanFilter,
  filterPlanTasks,
  sessionsOfTasks,
  type PlanFilter,
} from "../lib/planViews";
import { useUiStore } from "../store/ui";
import type { Task } from "../types";

/** 排期一次拉全量：总计划要看过去也看未来。 */
const SESSIONS_START = "2000-01-01";
const SESSIONS_END = "2099-12-31";

export function Tasks() {
  const [showArchived, setShowArchived] = useState(false);
  // 回收站开关：删掉的任务先放到这儿，随时能找回来。
  const [showTrash, setShowTrash] = useState(false);
  // 开关打开时连归档任务一起拉，归档的才看得见、才取消得了搁置。
  const { data: tasks = [], isLoading } = useTasks(showArchived);
  const { data: allSessions } = useSessionsInRange(SESSIONS_START, SESSIONS_END);
  const sessions = allSessions ?? [];
  const now = useCurrentTime();
  const today = toIsoDate(now);
  const taskView = useUiStore((s) => s.taskView);
  const setTaskView = useUiStore((s) => s.setTaskView);
  const { create, archive } = useTaskMutations();
  const [open, setOpen] = useState(false);
  const [knowledgeTask, setKnowledgeTask] = useState<KnowledgeTask | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState<PlanFilter>(emptyPlanFilter());

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 标签来自全部任务，筛选只影响显示，不影响标签本身。
  const tags = useMemo(
    () => collectPlanTags(tasks, sessions),
    [tasks, sessions],
  );
  const filteredTasks = useMemo(
    () => filterPlanTasks(tasks, sessions, filter),
    [tasks, sessions, filter],
  );
  const filteredSessions = useMemo(
    () => sessionsOfTasks(sessions, filteredTasks),
    [sessions, filteredTasks],
  );
  // 计划类视图只画还在用的任务，归档的留在归档分组里。
  const planTasks = useMemo(
    () => filteredTasks.filter((task) => !task.archived),
    [filteredTasks],
  );

  const submit = async (values: TaskFormValues) => {
    await create.mutateAsync({
      title: values.title,
      type: values.type,
      subject: values.type === "main" ? values.subject : null,
      textbook: values.type === "main" ? values.textbook || null : null,
      unit_name: values.unit_name,
      total_units: values.type === "main" ? values.total_units : null,
      total_rounds: values.type === "main" ? values.total_rounds : 1,
      color: values.color,
    });
    setOpen(false);
  };

  const unarchive = (task: Task) => {
    archive.mutate({ id: task.id, archived: false });
  };

  const isPlanView =
    taskView === "calendar" || taskView === "gantt" || taskView === "fishbone";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">总计划</h1>
          <p className="mt-1 text-xs text-ink-muted">
            主线学科长期进度与考点规划，先定计划，再看今天。
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex rounded-lg border border-white/10 p-0.5">
            <ViewButton
              label="列表视图"
              active={taskView === "list"}
              onClick={() => setTaskView("list")}
            >
              <ListIcon />
            </ViewButton>
            <ViewButton
              label="网格视图"
              active={taskView === "grid"}
              onClick={() => setTaskView("grid")}
            >
              <GridIcon />
            </ViewButton>
            <ViewButton
              label="日历视图"
              active={taskView === "calendar"}
              onClick={() => setTaskView("calendar")}
            >
              <CalendarIcon />
            </ViewButton>
            <ViewButton
              label="甘特视图"
              active={taskView === "gantt"}
              onClick={() => setTaskView("gantt")}
            >
              <GanttIcon />
            </ViewButton>
            <ViewButton
              label="鱼骨视图"
              active={taskView === "fishbone"}
              onClick={() => setTaskView("fishbone")}
            >
              <FishboneIcon />
            </ViewButton>
          </div>
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent-soft"
            onClick={() => setImportOpen(true)}
          >
            从教材导入
          </button>
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent-soft"
            onClick={() => setOpen(true)}
          >
            新建任务
          </button>
        </div>
      </div>

      <PlanFilterBar
        tags={tags}
        filter={filter}
        onChange={setFilter}
        matchedCount={filteredTasks.length}
        totalCount={tasks.length}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!isPlanView ? (
          <button
            type="button"
            aria-pressed={showArchived}
            onClick={() => setShowArchived((value) => !value)}
            className={`rounded-lg border px-3 py-1.5 text-xs ${
              showArchived
                ? "border-accent/60 bg-accent/10 text-accent"
                : "border-white/10 text-ink-muted hover:text-ink"
            }`}
          >
            显示已归档任务
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={showTrash}
          onClick={() => setShowTrash((value) => !value)}
          className={`rounded-lg border px-3 py-1.5 text-xs ${
            showTrash
              ? "border-accent/60 bg-accent/10 text-accent"
              : "border-white/10 text-ink-muted hover:text-ink"
          }`}
        >
          回收站
        </button>
      </div>

      {isLoading ? (
        <p className="text-ink-muted">加载中…</p>
      ) : taskView === "list" ? (
        <TaskListView
          tasks={filteredTasks}
          onOpenKnowledge={setKnowledgeTask}
          onUnarchive={unarchive}
        />
      ) : taskView === "grid" ? (
        <TaskGridView
          tasks={filteredTasks}
          onOpenKnowledge={setKnowledgeTask}
          onUnarchive={unarchive}
        />
      ) : taskView === "calendar" ? (
        <PlanCalendarView
          tasks={planTasks}
          sessions={filteredSessions}
          today={today}
        />
      ) : taskView === "gantt" ? (
        <PlanGanttView
          tasks={planTasks}
          sessions={filteredSessions}
          today={today}
        />
      ) : (
        <PlanFishboneView tasks={planTasks} />
      )}

      {showTrash ? (
        <RecycleBin
          onRestored={(task) => setToast(`「${task.title}」已找回来了。`)}
        />
      ) : null}

      <KnowledgePointDrawer task={knowledgeTask} onClose={() => setKnowledgeTask(null)} />

      {open ? (
        <TaskFormModal
          mode="create"
          onClose={() => setOpen(false)}
          onSubmit={submit}
          submitting={create.isPending}
        />
      ) : null}

      {toast ? (
        <p
          role="status"
          className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-lg border border-accent/40 bg-surface-2 px-4 py-2 text-sm text-ink shadow-lg"
        >
          {toast}
        </p>
      ) : null}
      {importOpen ? (
        <TextbookImportWizard
          onClose={() => setImportOpen(false)}
          onCreated={(plannedCount, autoSchedule, lastPlannedDate) => {
            setImportOpen(false);
            setToast(
              autoSchedule
                ? `任务创建成功，已生成 ${plannedCount} 个排期${
                    lastPlannedDate
                      ? `，铺到 ${formatMonthDay(lastPlannedDate)}`
                      : ""
                  }。`
                : "任务创建成功。",
            );
          }}
        />
      ) : null}
    </div>
  );
}

function ViewButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`rounded-md p-1.5 ${
        active ? "bg-white/10 text-ink" : "text-ink-muted hover:text-ink"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M8 7h11M8 12h11M8 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01"
      />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        d="M5 5h5.5v5.5H5zM13.5 5H19v5.5h-5.5zM5 13.5h5.5V19H5zM13.5 13.5H19V19h-5.5z"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4"
      />
    </svg>
  );
}

function GanttIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M4 7h9M4 12h13M4 17h6"
      />
    </svg>
  );
}

function FishboneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M4 12h13M7 12 12 6M11 12l5 6"
      />
    </svg>
  );
}
