import { create } from "zustand";
import { DEFAULT_EXAM_DATE, type NoteColor } from "../lib/constants";
import type { ExamTarget } from "../types";

const EXAMS_KEY = "timequest.exams";
const TRAY_KEY = "timequest.closeToTray";
const ALWAYS_ON_TOP_KEY = "timequest.alwaysOnTop";
const NOTIFICATIONS_KEY = "timequest.notifications";

function loadExams(): ExamTarget[] {
  try {
    const raw = localStorage.getItem(EXAMS_KEY);
    if (raw) return JSON.parse(raw) as ExamTarget[];
  } catch {
    /* ignore */
  }
  return [
    {
      id: "gaokao",
      name: "高考",
      date: DEFAULT_EXAM_DATE,
      isPrimary: true,
    },
  ];
}

export type TaskViewMode = "list" | "grid";

type UiState = {
  exams: ExamTarget[];
  closeToTray: boolean;
  alwaysOnTop: boolean;
  /** System toasts for upcoming and starting sessions. Default on. */
  notificationsEnabled: boolean;
  achievementToast: { title: string; description: string } | null;
  taskView: TaskViewMode;
  setExams: (exams: ExamTarget[]) => void;
  setPrimaryExam: (id: string) => void;
  upsertExam: (exam: ExamTarget) => void;
  removeExam: (id: string) => void;
  setCloseToTray: (v: boolean) => void;
  setAlwaysOnTop: (v: boolean) => void;
  setNotificationsEnabled: (v: boolean) => void;
  showAchievement: (a: { title: string; description: string } | null) => void;
  setTaskView: (view: TaskViewMode) => void;
};

export const useUiStore = create<UiState>((set, get) => ({
  exams: loadExams(),
  closeToTray: localStorage.getItem(TRAY_KEY) !== "0",
  alwaysOnTop: localStorage.getItem(ALWAYS_ON_TOP_KEY) === "1",
  notificationsEnabled: localStorage.getItem(NOTIFICATIONS_KEY) !== "0",
  achievementToast: null,
  taskView: "list",

  setExams: (exams) => {
    localStorage.setItem(EXAMS_KEY, JSON.stringify(exams));
    set({ exams });
  },
  setPrimaryExam: (id) => {
    const exams = get().exams.map((e) => ({
      ...e,
      isPrimary: e.id === id,
    }));
    localStorage.setItem(EXAMS_KEY, JSON.stringify(exams));
    set({ exams });
  },
  upsertExam: (exam) => {
    const others = get().exams.filter((e) => e.id !== exam.id);
    const exams = exam.isPrimary
      ? [...others.map((e) => ({ ...e, isPrimary: false })), exam]
      : [...others, exam];
    localStorage.setItem(EXAMS_KEY, JSON.stringify(exams));
    set({ exams });
  },
  removeExam: (id) => {
    let exams = get().exams.filter((e) => e.id !== id);
    if (exams.length && !exams.some((e) => e.isPrimary)) {
      exams = exams.map((e, i) => ({ ...e, isPrimary: i === 0 }));
    }
    localStorage.setItem(EXAMS_KEY, JSON.stringify(exams));
    set({ exams });
  },
  setCloseToTray: (v) => {
    localStorage.setItem(TRAY_KEY, v ? "1" : "0");
    set({ closeToTray: v });
  },
  setAlwaysOnTop: (v) => {
    localStorage.setItem(ALWAYS_ON_TOP_KEY, v ? "1" : "0");
    set({ alwaysOnTop: v });
  },
  setNotificationsEnabled: (v) => {
    localStorage.setItem(NOTIFICATIONS_KEY, v ? "1" : "0");
    set({ notificationsEnabled: v });
  },
  showAchievement: (a) => set({ achievementToast: a }),
  setTaskView: (taskView) => set({ taskView }),
}));

export type { NoteColor };
