import {
  FALLBACK_METHODS,
  FALLBACK_MOTIVATIONS,
  FALLBACK_SUBJECTS,
} from "./fallbacks";
import type { Subject } from "../types";

/**
 * 内容语料的解析层。
 *
 * 「配置优先 + 中文默认兜底」：赛道包（或赛道配置）给了就用它，
 * 没给就用 `src/lib/fallbacks.ts` 里的兜底清单。
 *
 * 解析函数都是纯函数：读配置的地方（hook、页面）负责把配置传进来。
 */

/** 当前赛道的科目名。库里没科目就退回兜底清单。 */
export function resolveSubjects(subjects: Subject[] | null | undefined): string[] {
  const names = (subjects ?? [])
    .map((subject) => subject.label.trim())
    .filter((label) => label.length > 0);
  const unique = [...new Set(names)];
  if (unique.length === 0) return [...FALLBACK_SUBJECTS];
  // 「其他」始终留在最后：它是兜底项，不是某一科的正式名字。
  return unique.includes("其他") ? unique : [...unique, "其他"];
}

/** 学习方式。 */
export function resolveMethods(
  methods: readonly string[] | null | undefined,
): string[] {
  const list = (methods ?? [])
    .map((method) => method.trim())
    .filter((method) => method.length > 0);
  return list.length > 0 ? [...new Set(list)] : [...FALLBACK_METHODS];
}

/** 每日激励语。 */
export function resolveMotivations(
  lines: readonly string[] | null | undefined,
): string[] {
  const list = (lines ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return list.length > 0 ? [...new Set(list)] : [...FALLBACK_MOTIVATIONS];
}
