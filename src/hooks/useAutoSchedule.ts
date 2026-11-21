import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { api } from "../api/tauri";
import { broadcastSessionUpdated } from "../lib/widgetWindow";

/**
 * 启动时补排今天的计划。
 *
 * 后端保证幂等：今天已经有安排（planned / done / missed）就一格都不排，
 * 所以这里重复调用也不会堆出重复场次。
 *
 * 只有真的排出了内容才失效缓存——首页与今日页要立刻看到新场次；
 * 悬浮窗也要跟着刷新，否则它还停在旧数据上。
 */
export function useAutoSchedule() {
  const qc = useQueryClient();

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void api
      .ensureTodaySchedule()
      .then((result) => {
        if (cancelled || result.created <= 0) return;
        qc.invalidateQueries({ queryKey: ["sessions"] });
        qc.invalidateQueries({ queryKey: ["sessions-range"] });
        qc.invalidateQueries({ queryKey: ["sessions-task"] });
        broadcastSessionUpdated();
      })
      .catch((error: unknown) => {
        // 自动排期失败不该打断启动：今天没排期只是回到老样子。
        console.warn("自动排期失败", error);
      });
    return () => {
      cancelled = true;
    };
  }, [qc]);
}