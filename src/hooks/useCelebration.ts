import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useAppSetting } from "./useAppSetting";
import {
  CELEBRATIONS_SETTING_KEY,
  celebrationMessage,
  fireConfetti,
  isCelebrationsEnabled,
  playCelebrationChord,
  useCelebrationStore,
  type CelebrationDetail,
  type CelebrationType,
} from "../lib/celebration";

/**
 * 全局庆祝。`enable_celebrations` 未设置时默认开启；
 * 显式写成 `0` 或 `false` 时，烟花、音效和浮层都不触发。
 */
export function useCelebration() {
  const queryClient = useQueryClient();
  const show = useCelebrationStore((state) => state.show);
  // 挂上查询，完成发生前设置通常已经在缓存里。
  useAppSetting(CELEBRATIONS_SETTING_KEY);

  const celebrate = useCallback(
    (type: CelebrationType, detail?: CelebrationDetail) => {
      const state = queryClient.getQueryState<string | null>([
        "appSetting",
        CELEBRATIONS_SETTING_KEY,
      ]);
      const value = state?.status === "success" ? (state.data ?? null) : null;
      if (!isCelebrationsEnabled(value)) return;
      void fireConfetti(type);
      playCelebrationChord(type);
      show(celebrationMessage(type, detail));
    },
    [queryClient, show],
  );

  return { celebrate };
}
