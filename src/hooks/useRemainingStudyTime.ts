import { useSessionsByDate } from "./useSessions";
import { todayStr } from "../lib/date";
import { resolveRemainingStudy, type RemainingStudy } from "../lib/studyCountdown";
import { useCurrentTime } from "./useCurrentTime";

/** Wall-clock view of today's planned sessions. Does not tick a stored total. */
export function useRemainingStudyTime(): {
  now: Date;
  pending: boolean;
  study: RemainingStudy;
} {
  const now = useCurrentTime(1000);
  const query = useSessionsByDate(todayStr(now));
  const sessions = query.data ?? [];
  return {
    now,
    pending: query.isPending,
    study: resolveRemainingStudy(sessions, now),
  };
}
