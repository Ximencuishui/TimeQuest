import { useEffect, useState } from "react";

const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Coarse wall-clock for time-of-day UI (timeline phases).
 * Defaults to 30s so the Today list does not re-render every second.
 */
export function useCurrentTime(intervalMs: number = DEFAULT_INTERVAL_MS): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
