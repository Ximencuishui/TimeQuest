import { useMemo } from "react";
import { useAppSetting } from "./useAppSetting";
import {
  DURATION_PRESETS_SETTING_KEY,
  POMODORO_PLAN_SETTING_KEY,
  parseDurationPresets,
  parsePomodoroPlan,
  serializeDurationPresets,
  serializePomodoroPlan,
  type DurationPreset,
  type PomodoroPlan,
} from "../lib/durationPresets";

/**
 * 全局常用时长。
 *
 * 存放在 `app_settings`，所有引用同一个 query key：
 * 任何一处保存，其它地方的常用时长按钮立刻一起变。
 */
export function useDurationPresets() {
  const query = useAppSetting(DURATION_PRESETS_SETTING_KEY);

  // 解析结果缓存一下：每次渲染都新建数组会让引用一直变。
  const presets = useMemo(() => parseDurationPresets(query.data), [query.data]);

  // 等写入真正落到库里再 resolve：编辑器要靠它判断「设置存上没有」。
  const savePresets = (next: DurationPreset[]) =>
    query.setSetting.mutateAsync(serializeDurationPresets(next));

  return { ...query, presets, savePresets };
}

/**
 * 全局番茄钟参数。
 *
 * 「按番茄钟生成」用的是这套参数：改了参数，下次打开编辑器还在。
 */
export function usePomodoroPlan() {
  const query = useAppSetting(POMODORO_PLAN_SETTING_KEY);

  const plan = useMemo(() => parsePomodoroPlan(query.data), [query.data]);

  // 等写入真正落到库里再 resolve：编辑器要靠它判断「设置存上没有」。
  const savePlan = (next: PomodoroPlan) =>
    query.setSetting.mutateAsync(serializePomodoroPlan(next));

  return { ...query, plan, savePlan };
}
