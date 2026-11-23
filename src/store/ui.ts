import { create } from "zustand";
import type { NoteColor } from "../lib/constants";

const TRAY_KEY = "timequest.closeToTray";
const ALWAYS_ON_TOP_KEY = "timequest.alwaysOnTop";
const NOTIFICATIONS_KEY = "timequest.notifications";

/** 总计划页的视图：列表 / 网格 / 日历 / 甘特 / 鱼骨。 */
export type TaskViewMode = "list" | "grid" | "calendar" | "gantt" | "fishbone";

type UiState = {
  closeToTray: boolean;
  alwaysOnTop: boolean;
  /** System toasts for upcoming and starting sessions. Default on. */
  notificationsEnabled: boolean;
  achievementToast: { title: string; description: string } | null;
  taskView: TaskViewMode;
  setCloseToTray: (v: boolean) => void;
  setAlwaysOnTop: (v: boolean) => void;
  setNotificationsEnabled: (v: boolean) => void;
  showAchievement: (a: { title: string; description: string } | null) => void;
  setTaskView: (view: TaskViewMode) => void;
};

export const useUiStore = create<UiState>((set) => ({
  closeToTray: localStorage.getItem(TRAY_KEY) !== "0",
  alwaysOnTop: localStorage.getItem(ALWAYS_ON_TOP_KEY) === "1",
  notificationsEnabled: localStorage.getItem(NOTIFICATIONS_KEY) !== "0",
  achievementToast: null,
  taskView: "list",

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