import { useEffect } from "react";
import { useGoalMutations, useGoals } from "../hooks/useGoals";
import { useUserProfile } from "../hooks/useUserProfile";
import { DEFAULT_EXAM_DATE, DEFAULT_GOAL_NAME } from "../lib/constants";
import { gaokaoDateForGrade } from "../lib/examDate";
import { resolvePrimaryGoal } from "../lib/goals";

/**
 * The countdown date lives in the goal list, not in `user_profile`.
 * A profile saved as 高二 can still be showing the old 高三 seed `2027-06-07`.
 * Replace only that seed. A date the user picked themselves stays put.
 */
export function ExamDateSync() {
  const profile = useUserProfile();
  const { data: goals = [] } = useGoals();
  const { upsert } = useGoalMutations();
  // `upsert` 是 useMutation 的返回对象，每次渲染都是新的；依赖它会让 effect 反复跑。
  const mutate = upsert.mutate;

  useEffect(() => {
    const grade = profile.data?.grade;
    if (!grade) return;
    const next = gaokaoDateForGrade(grade);
    if (next === DEFAULT_EXAM_DATE) return;
    const primary = resolvePrimaryGoal(goals);
    if (primary && primary.date !== DEFAULT_EXAM_DATE) return;
    mutate({
      id: primary?.id,
      name: primary?.name ?? DEFAULT_GOAL_NAME,
      date: next,
      kind: primary?.kind ?? "exam",
      isPrimary: true,
    });
  }, [profile.data, goals, mutate]);

  return null;
}