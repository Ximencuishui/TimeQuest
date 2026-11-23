import { describe, expect, it } from "vitest";
import { examScoreBreakdown, scaledTotalNote } from "../scoreScaling";
import { SUBJECT_FIXTURES, examSession } from "../../test/subjectFixtures";
import type { Subject } from "../../types";

/**
 * 4.0 升级前后的折算口径逐位比对。
 *
 * 4.0 之前 `src/lib/scoreScaling.ts` 把六科与总分 610 写死在代码里；
 * 现在满分跟着 `subjects` 表走。六科配置下两条路径必须给出同一个数，
 * 否则老用户升级后成绩页上的折算分会漂。
 *
 * 这里的 `legacyBreakdown` 是升级前实现的逐行照抄（只把 key 从
 * `chinese_score` 换成科目 key，便于逐项比对）。比对始终用老口径的
 * 科目满分（LEGACY_SUBJECT_FIXTURES）；现役种子（语数英 150 / 其余 100）
 * 的合计另用一个用例锁定。
 */

const LEGACY_SUBJECT_FIELDS = [
  { key: "chinese", label: "语文", fullMark: 120 },
  { key: "math", label: "数学", fullMark: 130 },
  { key: "english", label: "英语", fullMark: 120 },
  { key: "physics", label: "物理", fullMark: 80 },
  { key: "chemistry", label: "化学", fullMark: 80 },
  { key: "biology", label: "生物", fullMark: 80 },
] as const;

const LEGACY_TOTAL_FULL_MARKS = 610;
const LEGACY_MIN_SUBJECTS_FOR_SCALING = 2;

const LEGACY_SUBJECT_FIXTURES: Subject[] = LEGACY_SUBJECT_FIELDS.map((field, index) => ({
  id: index + 1,
  key: field.key,
  label: field.label,
  fullMark: field.fullMark,
  goal: field.fullMark,
  unit: "分",
  orderIndex: index,
  trackId: null,
}));

type LegacyBreakdown = {
  filled: { key: string; label: string; score: number }[];
  missing: { key: string; label: string }[];
  sum: number;
  takenFullMarks: number;
  scaledTotal: number | null;
  rate: number;
};

function legacyBreakdown(scores: (number | null)[]): LegacyBreakdown {
  const filled: LegacyBreakdown["filled"] = [];
  const missing: LegacyBreakdown["missing"] = [];
  let sum = 0;
  let takenFullMarks = 0;

  LEGACY_SUBJECT_FIELDS.forEach((field, index) => {
    const score = scores[index] ?? null;
    if (score == null) {
      missing.push({ key: field.key, label: field.label });
      return;
    }
    filled.push({ key: field.key, label: field.label, score });
    sum += score;
    takenFullMarks += field.fullMark;
  });

  let scaledTotal: number | null = null;
  if (filled.length > 0) {
    scaledTotal =
      filled.length === LEGACY_SUBJECT_FIELDS.length
        ? sum
        : Math.round((sum * LEGACY_TOTAL_FULL_MARKS) / takenFullMarks);
  }

  return {
    filled,
    missing,
    sum,
    takenFullMarks,
    scaledTotal,
    rate: takenFullMarks === 0 ? 0 : sum / takenFullMarks,
  };
}

function legacyNote(scores: (number | null)[]): string | null {
  const breakdown = legacyBreakdown(scores);
  if (breakdown.missing.length === 0) return null;
  if (breakdown.filled.length < LEGACY_MIN_SUBJECTS_FOR_SCALING) return null;
  if (breakdown.scaledTotal == null) return null;
  return `实考 ${breakdown.sum} / ${breakdown.takenFullMarks} · 折算 ${breakdown.scaledTotal} / ${LEGACY_TOTAL_FULL_MARKS}`;
}

const CASES: { name: string; scores: (number | null)[] }[] = [
  { name: "六科全齐", scores: [118, 135, 118, 82, 80, 80] },
  { name: "缺生物", scores: [110, 130, 115, 70, 75, null] },
  { name: "缺三科", scores: [110, 130, 115, null, null, null] },
  { name: "只考一科", scores: [null, 135, null, null, null, null] },
  { name: "空卷", scores: [null, null, null, null, null, null] },
  { name: "有零分科目", scores: [0, 130, 115, 70, 75, null] },
  { name: "各科满分", scores: [120, 130, 120, 80, 80, 80] },
  { name: "只考两科", scores: [100, 120, null, null, null, null] },
  { name: "只缺生物", scores: [110, 130, 115, 70, 75, 74] },
];

describe("4.0 升级前后折算口径逐位一致", () => {
  it.each(CASES)("$name：新旧口径给出同一个折算总分", ({ scores }) => {
    const session = examSession(7, "期中", "2026-11-01", scores, LEGACY_SUBJECT_FIXTURES);
    const legacy = legacyBreakdown(scores);
    const current = examScoreBreakdown(session, LEGACY_SUBJECT_FIXTURES);

    expect(current.sum).toBe(legacy.sum);
    expect(current.takenFullMarks).toBe(legacy.takenFullMarks);
    expect(current.scaledTotal).toBe(legacy.scaledTotal);
    expect(current.rate).toBe(legacy.rate);
    expect(current.filled.map((row) => [row.label, row.score])).toEqual(
      legacy.filled.map((row) => [row.label, row.score]),
    );
    expect(current.missing.map((row) => row.label)).toEqual(
      legacy.missing.map((row) => row.label),
    );
    expect(scaledTotalNote(session, LEGACY_SUBJECT_FIXTURES)).toBe(legacyNote(scores));
  });

  it("六科种子数据下总分是 750", () => {
    const session = examSession(8, "满卷", "2026-11-02", [150, 150, 150, 100, 100, 100]);
    const current = examScoreBreakdown(session, SUBJECT_FIXTURES);
    expect(current.takenFullMarks).toBe(750);
    expect(current.scaledTotal).toBe(750);
  });
});
