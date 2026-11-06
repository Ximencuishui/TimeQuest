export type TaskType = "main" | "side";
export type SessionStatus = "planned" | "done" | "missed" | "rescheduled";
export type TagType = "study" | "sport" | "game" | "other";

export type Task = {
  id: number;
  title: string;
  type: TaskType;
  subject: string | null;
  textbook: string | null;
  unit_name: string;
  total_units: number | null;
  total_rounds: number;
  current_round: number;
  color: string | null;
  archived: number;
  created_at: string;
  actual_units_sum?: number;
};

export type TaskSession = {
  id: number;
  task_id: number;
  date: string;
  start_time: string;
  end_time: string;
  round: number;
  status: SessionStatus;
  planned_units: number;
  actual_units: number;
  self_rating: number | null;
  self_note: string | null;
  rescheduled_to: number | null;
  xp_awarded: number;
  created_at: string;
  task_title?: string;
  task_type?: TaskType;
  task_color?: string | null;
  subject?: string | null;
};

export type ActualLog = {
  id: number;
  date: string;
  start_at: string | null;
  end_at: string | null;
  duration_min: number;
  subject: string | null;
  method: string | null;
  tag_type: TagType;
  session_id: number | null;
  note: string | null;
  created_at: string;
};

export type Note = {
  id: number;
  content: string;
  color: string;
  pinned: number;
  created_at: string;
  updated_at: string;
};

export type UserStats = {
  id: number;
  total_xp: number;
  current_level: number;
  current_streak: number;
  longest_streak: number;
  last_done_date: string | null;
};

export type Achievement = {
  id: string;
  name: string;
  description: string;
};

export type UserAchievement = {
  achievement_id: string;
  unlocked_at: string;
  name?: string;
  description?: string;
};

export type ExamTarget = {
  id: string;
  name: string;
  date: string;
  isPrimary: boolean;
};

export type PlanVsActualRow = {
  subject: string;
  planned_min: number;
  actual_min: number;
};

export type MethodShareRow = {
  method: string;
  duration_min: number;
};

export type TagTypeRow = {
  tag_type: string;
  duration_min: number;
};

export type CompletionRate = {
  done: number;
  missed: number;
  rescheduled: number;
  rate: number;
};

export type AvgRatingRow = {
  key: string;
  avg_rating: number;
  count: number;
};

export type DailyUnitsRow = {
  date: string;
  units: number;
};

export type CompleteSessionInput = {
  sessionId: number;
  actualUnits: number;
  selfRating: number;
  selfNote?: string | null;
  method?: string | null;
  deferRemaining?: boolean;
  deferDate?: string | null;
  deferStart?: string | null;
  deferEnd?: string | null;
};

export type RescheduleInput = {
  sessionId: number;
  date: string;
  startTime: string;
  endTime: string;
};

export type CompleteSessionResult = {
  session: TaskSession;
  xpAwarded: number;
  newAchievements: string[];
  createdSessionId: number | null;
  remainderSessionId: number | null;
};

export type TextbookChapter = {
  name: string;
  sections: string[];
};

export type TextbookOutline = {
  subject: string;
  version: string;
  volume: string;
  chapters: TextbookChapter[];
};

export type GenerateTasksFromOutlineInput = {
  subject: string;
  version: string;
  volume: string;
  taskName: string;
  selectedSections: string[];
  autoSchedule: boolean;
};

export type AvailableTextbook = {
  subject: string;
  version: string;
  volume: string;
};

export type GenerateTasksResult = {
  taskId: number;
  totalUnits: number;
  plannedCount: number;
  doneCount: number;
};

export type ImportTextbookResult = {
  outline: TextbookOutline;
  replaced: boolean;
};

export type TextbookCatalogItem = {
  subject: string;
  version: string;
  volume: string;
  source: string;
};
