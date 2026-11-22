import { formatDurationLabel } from "./timeField";
import type { DurationShiftChange, PresetDurationShiftResult } from "../types";

/**
 * 常用时长：点一下就能定好「这一场学多久」。
 *
 * 默认值来自番茄钟算法：25 分钟专注 + 5 分钟短休息，
 * 攒够 4 个番茄再来一次 15 分钟长休息。
 *
 * 学生可以自己改，保存后全局生效：
 * 新建排期、改期都用同一套；改了时长，今天及以后排在这个旧时长上的场次
 * 会跟着改到新时长，已经完成的历史不动。
 */

/** `app_settings` 里存常用时长的键。 */
export const DURATION_PRESETS_SETTING_KEY = "duration_presets";

/** `app_settings` 里存番茄钟参数的键。 */
export const POMODORO_PLAN_SETTING_KEY = "pomodoro_plan";

/** 一段常用时长。 */
export type DurationPreset = {
  /**
   * 稳定标识。
   *
   * 改名不惊动计划，改分钟数才惊动——和常用时段是同一套思路。
   */
  id: string;
  /** 按钮上的名字，例如「番茄 1」「整轮」。 */
  label: string;
  /** 时长（分钟）。 */
  minutes: number;
};

/**
 * 番茄钟参数。
 *
 * 经典配置：25 分钟专注 + 5 分钟短休息，攒够 4 个番茄来一次 15 分钟长休息。
 */
export type PomodoroPlan = {
  /** 一个番茄的专注时长（分钟）。 */
  focusMinutes: number;
  /** 两个番茄之间的短休息（分钟）。 */
  breakMinutes: number;
  /** 攒够一轮后的长休息（分钟）。 */
  longBreakMinutes: number;
  /** 几个番茄算一轮。 */
  roundsBeforeLongBreak: number;
};

export const DEFAULT_POMODORO_PLAN: PomodoroPlan = {
  focusMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLongBreak: 4,
};

/** 一场自习最长按一天算，跨天的排期没有意义。 */
export const MAX_DURATION_MINUTES = 24 * 60;

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function toNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

/**
 * 把番茄钟参数规整成能用的值。
 *
 * 专注至少 1 分钟，休息可以为 0，一轮最多 12 个番茄。
 */
export function normalizePomodoroPlan(plan: PomodoroPlan): Required<PomodoroPlan> {
  return {
    focusMinutes: toPositiveInt(plan.focusMinutes, DEFAULT_POMODORO_PLAN.focusMinutes),
    breakMinutes: toNonNegativeInt(plan.breakMinutes, DEFAULT_POMODORO_PLAN.breakMinutes),
    longBreakMinutes: toNonNegativeInt(
      plan.longBreakMinutes,
      DEFAULT_POMODORO_PLAN.longBreakMinutes,
    ),
    roundsBeforeLongBreak: Math.max(
      1,
      Math.min(
        12,
        toPositiveInt(
          plan.roundsBeforeLongBreak,
          DEFAULT_POMODORO_PLAN.roundsBeforeLongBreak,
        ),
      ),
    ),
  };
}

/**
 * 按番茄钟算法算出推荐的常用时长。
 *
 * 口径是「墙钟时长」：一段 2 个番茄的时段 =
 * 专注 25 + 短休息 5 + 专注 25 = 55 分钟，
 * 因为中间那 5 分钟的休息人也是坐在桌前的。
 *
 * 默认参数下得到：25 / 55 / 85 / 115 分钟，加一轮含长休息的 130 分钟。
 *
 * 超过一天的时长（1440 分钟）不生成：一天排不下那么长，
 * 生成一版存不下来的时长只会让用户白改一遍。
 */
export function buildPomodoroDurations(plan: PomodoroPlan): DurationPreset[] {
  const normalized = normalizePomodoroPlan(plan);
  const candidates: DurationPreset[] = [];
  let minutes = 0;
  for (let round = 1; round <= normalized.roundsBeforeLongBreak; round += 1) {
    minutes += normalized.focusMinutes;
    candidates.push({ id: `dp-pomo-${round}`, label: `番茄 ${round}`, minutes });
    // 最后一个番茄后面不接短休息——那是下一轮的事了。
    if (round < normalized.roundsBeforeLongBreak) minutes += normalized.breakMinutes;
  }
  candidates.push({
    id: "dp-pomo-round",
    label: `整轮（${normalized.roundsBeforeLongBreak} 番茄 + 长休息）`,
    minutes: minutes + normalized.longBreakMinutes,
  });
  return candidates.filter((preset) => preset.minutes <= MAX_DURATION_MINUTES);
}

/** 默认常用时长：番茄钟算法推荐的五段。 */
export const DEFAULT_DURATION_PRESETS: DurationPreset[] = buildPomodoroDurations(
  DEFAULT_POMODORO_PLAN,
);

/** 一段常用时长是否成立：名字非空，分钟数是 1~1440 的整数。 */
export function isValidDurationPreset(preset: {
  label: string;
  minutes: number;
}): boolean {
  if (preset.label.trim() === "") return false;
  if (!Number.isFinite(preset.minutes)) return false;
  const minutes = Math.trunc(preset.minutes);
  return minutes >= 1 && minutes <= MAX_DURATION_MINUTES;
}

/**
 * 让 id 在同一份列表里唯一。
 *
 * 缺 id 的行会拿到 `dp-<序号>` 这样的兑底 id，理论上可能和另一行显式写的 id 撞车；
 * 撞上了就加后缀，免得两行被当成同一行（diff 时会漏掉一次改动）。
 */
function uniqueId(id: string, used: Set<string>): string {
  if (!used.has(id)) {
    used.add(id);
    return id;
  }
  let counter = 2;
  while (used.has(`${id}-${counter}`)) {
    counter += 1;
  }
  const next = `${id}-${counter}`;
  used.add(next);
  return next;
}

/**
 * 读回常用时长。
 *
 * 没设置过就给番茄钟推荐的默认五段；写坏了也退回默认，
 * 免得设置坏一次就再也点不到快捷时长。
 *
 * 合法的空数组（用户把预设全删了）要原样尊重。
 */
export function parseDurationPresets(raw: string | null | undefined): DurationPreset[] {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return DEFAULT_DURATION_PRESETS.map((preset) => ({ ...preset }));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_DURATION_PRESETS.map((preset) => ({ ...preset }));
  }
  if (!Array.isArray(parsed)) {
    return DEFAULT_DURATION_PRESETS.map((preset) => ({ ...preset }));
  }

  const presets: DurationPreset[] = [];
  const usedIds = new Set<string>();
  parsed.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const obj = item as { id?: unknown; label?: unknown; minutes?: unknown };
    const label = typeof obj.label === "string" ? obj.label.trim() : "";
    // 这里不能用 toPositiveInt：0 和负数应该被当「非法」丢弃，而不是抬成 1。
    const rawMinutes = typeof obj.minutes === "number" ? obj.minutes : Number(obj.minutes);
    const minutes = Number.isFinite(rawMinutes) ? Math.trunc(rawMinutes) : 0;
    if (!isValidDurationPreset({ label, minutes })) return;
    const rawId =
      typeof obj.id === "string" && obj.id.trim() !== "" ? obj.id.trim() : `dp-${index}`;
    presets.push({ id: uniqueId(rawId, usedIds), label, minutes });
  });
  return presets;
}

/** 把常用时长写进 `app_settings`。 */
export function serializeDurationPresets(presets: DurationPreset[]): string {
  return JSON.stringify(
    presets.map((preset) => ({
      id: preset.id,
      label: preset.label.trim(),
      minutes: Math.trunc(preset.minutes),
    })),
  );
}

/** 读回番茄钟参数；写坏了就退回默认参数。 */
export function parsePomodoroPlan(raw: string | null | undefined): PomodoroPlan {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { ...DEFAULT_POMODORO_PLAN };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_POMODORO_PLAN };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_POMODORO_PLAN };
  }
  const obj = parsed as Partial<PomodoroPlan>;
  return normalizePomodoroPlan({
    focusMinutes: obj.focusMinutes ?? DEFAULT_POMODORO_PLAN.focusMinutes,
    breakMinutes: obj.breakMinutes ?? DEFAULT_POMODORO_PLAN.breakMinutes,
    longBreakMinutes: obj.longBreakMinutes ?? DEFAULT_POMODORO_PLAN.longBreakMinutes,
    roundsBeforeLongBreak:
      obj.roundsBeforeLongBreak ?? DEFAULT_POMODORO_PLAN.roundsBeforeLongBreak,
  });
}

/** 把番茄钟参数写进 `app_settings`。 */
export function serializePomodoroPlan(plan: PomodoroPlan): string {
  return JSON.stringify({
    focusMinutes: Math.trunc(plan.focusMinutes),
    breakMinutes: Math.trunc(plan.breakMinutes),
    longBreakMinutes: Math.trunc(plan.longBreakMinutes),
    roundsBeforeLongBreak: Math.trunc(plan.roundsBeforeLongBreak),
  });
}

/** 一次「旧时长 → 新时长」的改动。 */
export type { DurationShiftChange };

/**
 * 算出哪些常用时长改了分钟数。
 *
 * 身份靠 id 对齐：只改名字不动时间，就不该惊动任何排期；
 * 改了分钟数，才需要把已经排在这个旧时长上的未来排期一起改掉。
 *
 * 两个预设从同一个旧时长改到不同的新时长时，无法判断哪些排期归谁，
 * 这类旧时长整段放弃（返回结果里不出现），宁可不动也不乱改。
 */
export function diffDurationPresets(
  oldList: DurationPreset[],
  newList: DurationPreset[],
): DurationShiftChange[] {
  const oldById = new Map(oldList.map((preset) => [preset.id, preset]));
  const targets = new Map<number, { change: DurationShiftChange; ambiguous: boolean }>();

  for (const preset of newList) {
    const old = oldById.get(preset.id);
    if (!old) continue;
    if (old.minutes === preset.minutes) continue;
    const change: DurationShiftChange = {
      fromMinutes: old.minutes,
      toMinutes: preset.minutes,
    };
    const existing = targets.get(old.minutes);
    if (!existing) {
      targets.set(old.minutes, { change, ambiguous: false });
      continue;
    }
    if (existing.change.toMinutes !== change.toMinutes) {
      existing.ambiguous = true;
    }
  }

  return [...targets.values()]
    .filter((entry) => !entry.ambiguous)
    .map((entry) => entry.change);
}

/** 新增一个预设时用的 id：本地生成即可，只要同一份列表里不重复。 */
export function newDurationPresetId(existing: DurationPreset[]): string {
  const used = new Set(existing.map((preset) => preset.id));
  let counter = existing.length + 1;
  let id = `dp-custom-${counter}`;
  while (used.has(id)) {
    counter += 1;
    id = `dp-custom-${counter}`;
  }
  return id;
}

/** 按钮上的文案：名字 + 时长，例如「番茄 1 · 25 分钟」。 */
export function formatDurationPresetLabel(preset: DurationPreset): string {
  return `${preset.label} · ${formatDurationLabel(preset.minutes)}`;
}

/**
 * 改完常用时长后的反馈文案。
 *
 * 改掉的和撞车保持原样的都要说清楚：只报「已改 N 场」会让人以为全部生效，
 * 实际上撞车的那几场还停在旧时长上。
 */
export function summarizeDurationShift(result: PresetDurationShiftResult): string {
  if (result.updated > 0) {
    return `已保存，${result.updated} 场排期已改成新的常用时长${
      result.conflicts > 0 ? `；${result.conflicts} 场撞车保持原样` : ""
    }。`;
  }
  if (result.conflicts > 0) {
    return `已保存；${result.conflicts} 场排期改过去会撞车，保持原样。`;
  }
  return "已保存。";
}
