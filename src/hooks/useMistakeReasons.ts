import { useMemo } from "react";
import { useAppSetting } from "./useAppSetting";
import {
  MISTAKE_REASONS_SETTING_KEY,
  resolveMistakeReasons,
} from "../lib/mistakes";

/**
 * 错因白名单。
 *
 * 赛道包装了错因表就写进 `app_settings`，前后端读的是同一份：
 * 前端渲染下拉框，后端用它归一错因。
 */
export function useMistakeReasons(): string[] {
  const { data } = useAppSetting(MISTAKE_REASONS_SETTING_KEY);
  return useMemo(() => resolveMistakeReasons(parseReasons(data)), [data]);
}

/** 设置里存的是 JSON 数组；读不懂就当作没配置。 */
function parseReasons(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
