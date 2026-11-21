import { useMemo } from "react";
import { useAppSetting } from "./useAppSetting";
import {
  TIME_PRESETS_SETTING_KEY,
  parseTimePresets,
  serializeTimePresets,
  type TimePreset,
} from "../lib/timePresets";

/**
 * 全局常用时段。
 *
 * 存放在 `app_settings`，所有引用同一个 query key：
 * 任何一处保存，其它地方的常用时段按钮立刻一起变。
 */
export function useTimePresets() {
  const query = useAppSetting(TIME_PRESETS_SETTING_KEY);

  // 解析结果缓存一下：每次渲染都新建数组会让引用一直变。
  const presets = useMemo(() => parseTimePresets(query.data), [query.data]);

  // 等写入真正落到库里再 resolve：编辑器要靠它判断「设置存上没有」，
  // 存失败时才能如实告诉用户「排期改了、设置没存上」。
  const savePresets = (next: TimePreset[]) =>
    query.setSetting.mutateAsync(serializeTimePresets(next));

  return { ...query, presets, savePresets };
}