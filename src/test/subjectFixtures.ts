import type { ExamSession, Subject } from "../types";

/**
 * 科目字典的测试夹具。
 *
 * 默认六科满分语数英各 150、物化生各 100（合计 750）；目标分沿用老口径（合计 610），
 * 与 `subjects` 表的种子数据一致。
 */
export const SUBJECT_FIXTURES: Subject[] = [
  { id: 1, key: "chinese", label: "语文", fullMark: 150, goal: 120, unit: "分", orderIndex: 0, trackId: null },
  { id: 2, key: "math", label: "数学", fullMark: 150, goal: 130, unit: "分", orderIndex: 1, trackId: null },
  { id: 3, key: "english", label: "英语", fullMark: 150, goal: 120, unit: "分", orderIndex: 2, trackId: null },
  { id: 4, key: "physics", label: "物理", fullMark: 100, goal: 80, unit: "分", orderIndex: 3, trackId: null },
  { id: 5, key: "chemistry", label: "化学", fullMark: 100, goal: 80, unit: "分", orderIndex: 4, trackId: null },
  { id: 6, key: "biology", label: "生物", fullMark: 100, goal: 80, unit: "分", orderIndex: 5, trackId: null },
];

/**
 * 造一场考试。`scores` 按 `subjects` 的顺序给分，`null` 表示这场没考这科。
 */
export function examSession(
  id: number,
  name: string,
  date: string,
  scores: (number | null)[],
  subjects: Subject[] = SUBJECT_FIXTURES,
): ExamSession {
  return {
    id,
    trackId: null,
    name,
    date,
    createdAt: `${date} 12:00:00`,
    scores: subjects.map((subject, index) => ({
      id: id * 100 + index,
      examId: id,
      subjectId: subject.id,
      score: scores[index] ?? null,
    })),
  };
}
