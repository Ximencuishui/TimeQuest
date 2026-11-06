import { useEffect } from "react";
import { useUserProfile } from "../hooks/useUserProfile";
import { DEFAULT_EXAM_DATE } from "../lib/constants";
import { gaokaoDateForGrade } from "../lib/examDate";
import { useUiStore } from "../store/ui";

/**
 * The countdown date lives in the exam list, not in `user_profile`.
 * A profile saved as 高二 can still be showing the old 高三 seed `2027-06-07`.
 * Replace only that seed. A date the user picked themselves stays put.
 */
export function ExamDateSync() {
  const profile = useUserProfile();
  const exams = useUiStore((s) => s.exams);
  const upsertExam = useUiStore((s) => s.upsertExam);

  useEffect(() => {
    const grade = profile.data?.grade;
    if (!grade) return;
    const next = gaokaoDateForGrade(grade);
    if (next === DEFAULT_EXAM_DATE) return;
    const primary = exams.find((item) => item.isPrimary) ?? exams[0];
    if (primary && primary.date !== DEFAULT_EXAM_DATE) return;
    upsertExam({
      id: primary?.id ?? "gaokao",
      name: primary?.name ?? "高考",
      date: next,
      isPrimary: true,
    });
  }, [profile.data, exams, upsertExam]);

  return null;
}
