import type { ExamSession, Subject } from "../types";

/**
 * 科目字典的测试夹具。
 *
 * 默认六科（语文 120 + 数学 130 + 英语 120 + 理化生各 80，合计 610），
 * 与 `subjects` 表的种子数据一致。
 */
export const SUBJECT_FIXTURES: Subject[] = [
  { id: 1, key: "chinese", label: "语文", fullMark: 120, goal: 120, unit: "分", orderIndex: 0 },
  { id: 2, key: "math", label: "数学", fullMark: 130, goal: 130, unit: "分", orderIndex: 1 },
  { id: 3, key: "english", label: "英语", fullMark: 120, goal: 120, unit: "分", orderIndex: 2 },
  { id: 4, key: "physics", label: "物理", fullMark: 80, goal: 80, unit: "分", orderIndex: 3 },
  { id: 5, key: "chemistry", label: "化学", fullMark: 80, goal: 80, unit: "分", orderIndex: 4 },
  { id: 6, key: "biology", label: "生物", fullMark: 80, goal: 80, unit: "分", orderIndex: 5 },
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