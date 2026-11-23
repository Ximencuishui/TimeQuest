import { useMemo } from "react";
import { useAppSetting } from "./useAppSetting";
import { resolveMethods } from "../lib/content";

/**
 * 学习方式清单。
 *
 * 赛道包可以带一份自己的学习方式，装上就写进 `app_settings`；
 * 没装包 / 读不出来 / 包是坏的，都回落到内置兜底清单。
 */
export function useStudyMethods(): string[] {
  const { data } = useAppSetting("track.methods");
  return useMemo(() => resolveMethods(parseMethods(data)), [data]);
}

/** 设置里存的是 JSON 数组；读不懂就当作没配置。 */
function parseMethods(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
