import { useSessionsByDate } from "./useSessions";
import { todayStr } from "../lib/date";
import { resolveRemainingStudy, type RemainingStudy } from "../lib/studyCountdown";
import { useCurrentTime } from "./useCurrentTime";
import { useAppSetting } from "./useAppSetting";
import { DAILY_LIMIT_SETTING_KEY, parseDailyLimit } from "../lib/studyPlan";

/** Wall-clock view of today's planned sessions. Does not tick a stored total. */
export function useRemainingStudyTime(): {
  now: Date;
  pending: boolean;
  study: RemainingStudy;
  limitMinutes: number;
} {
  const now = useCurrentTime(1000);
  const query = useSessionsByDate(todayStr(now));
  const limit = useAppSetting(DAILY_LIMIT_SETTING_KEY);
  const limitMinutes = parseDailyLimit(limit.data);
  const sessions = query.data ?? [];
  return {
    now,
    pending: query.isPending,
    study: resolveRemainingStudy(sessions, now, limitMinutes),
    limitMinutes,
  };
}
