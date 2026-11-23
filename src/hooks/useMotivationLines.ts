import { useEffect, useState } from "react";
import { api } from "../api/tauri";
import { usePlugins } from "./usePlugins";
import { useActiveTrack } from "./useTracks";
import { FALLBACK_MOTIVATIONS } from "../lib/fallbacks";
import { parseMotivationPack } from "../lib/motivation";

/**
 * 当前赛道的每日激励语。
 *
 * 赛道包装了语料包（`motivation_pack`）就用它的；没装包 / 读不出来 /
 * 包是坏的，都回落到内置兜底语料。
 */
export function useMotivationLines(): readonly string[] {
  const { track } = useActiveTrack();
  const plugins = usePlugins();
  const [lines, setLines] = useState<string[]>([]);

  const plugin = (plugins.data ?? []).find(
    (item) =>
      item.installed &&
      item.kind === "track" &&
      Boolean(item.provides?.motivation_pack) &&
      (!item.provides?.track?.name || item.provides.track.name === track?.name),
  );
  const pluginId = plugin?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!pluginId) {
      setLines([]);
      return;
    }
    api
      .readPluginMotivationPack(pluginId)
      .then((raw) => {
        if (!cancelled) setLines(parseMotivationPack(raw));
      })
      .catch(() => {
        if (!cancelled) setLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId]);

  return lines.length > 0 ? lines : FALLBACK_MOTIVATIONS;
}
