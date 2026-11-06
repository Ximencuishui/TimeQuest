import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { api } from "../api/tauri";
import { APP_NAME } from "../lib/constants";
import { todayStr } from "../lib/date";
import {
  loadSentNotices,
  planSessionNotices,
  saveSentNotices,
  type PlannedNotice,
} from "../lib/sessionNotices";
import type { TaskSession } from "../types";
import { useUiStore } from "../store/ui";
import { useCurrentTime } from "./useCurrentTime";

const MINUTE_MS = 60_000;
const NO_SESSIONS: TaskSession[] = [];

async function canSendNotification(asked: { current: boolean }): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    if (asked.current) return false;
    asked.current = true;
    const permission = await requestPermission();
    return permission === "granted";
  } catch {
    asked.current = true;
    return false;
  }
}

function deliver(items: PlannedNotice[]): void {
  for (const item of items) {
    try {
      sendNotification({ title: APP_NAME, body: item.body });
    } catch {
      /* one toast failed; keep the rest quiet */
    }
  }
}

/** Main-window scheduler: one prep toast and one start toast per planned session. */
export function useSessionNotifier() {
  const enabled = useUiStore((s) => s.notificationsEnabled);
  const now = useCurrentTime(MINUTE_MS);
  const today = todayStr(now);
  const asked = useRef(false);
  const sentRef = useRef<{ date: string; keys: Set<string> } | null>(null);

  const { data } = useQuery({
    queryKey: ["sessions", today],
    queryFn: () => api.listSessionsByDate(today),
    enabled,
  });
  const sessions = data ?? NO_SESSIONS;

  useEffect(() => {
    if (!enabled || !isTauri()) return;
    if (!sentRef.current || sentRef.current.date !== today) {
      sentRef.current = { date: today, keys: loadSentNotices(today) };
    }
    const bucket = sentRef.current;
    const due = planSessionNotices(sessions, now, bucket.keys);
    if (due.length === 0) return;
    for (const item of due) bucket.keys.add(item.key);
    saveSentNotices(today, bucket.keys);
    void canSendNotification(asked).then((allowed) => {
      if (allowed) deliver(due);
    });
  }, [enabled, now, sessions, today]);
}
