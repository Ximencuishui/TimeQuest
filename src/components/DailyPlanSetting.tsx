import { useState } from "react";
import { MAX_DAILY_STUDY_MINUTES } from "../lib/constants";
import { useAppSetting, useSetSetting } from "../hooks/useAppSetting";
import {
  DAILY_LIMIT_SETTING_KEY,
  DAILY_SLOTS_SETTING_KEY,
  DAILY_SLOT_PRESETS,
  type DailySlot,
  dailySlotMinutes,
  isValidDailySlot,
  parseDailyLimit,
  parseDailySlots,
  serializeDailySlots,
} from "../lib/studyPlan";

/**
 * 每日可用时段 + 每日学习上限。
 *
 * 防呆：学生先说清楚自己每天什么时候能学、能学多久，
 * 后面的一键排期和「今日剩余待学」都按这里算。
 */
export function DailyPlanSetting() {
  const slotsQuery = useAppSetting(DAILY_SLOTS_SETTING_KEY);
  const limitQuery = useAppSetting(DAILY_LIMIT_SETTING_KEY);
  const setSlots = useSetSetting(DAILY_SLOTS_SETTING_KEY);
  const setLimit = useSetSetting(DAILY_LIMIT_SETTING_KEY);

  const [slotsDraft, setSlotsDraft] = useState<DailySlot[] | null>(null);
  const [limitDraft, setLimitDraft] = useState<number | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const slots = slotsDraft ?? parseDailySlots(slotsQuery.data);
  const limitMinutes = limitDraft ?? parseDailyLimit(limitQuery.data);

  const updateSlot = (index: number, patch: Partial<DailySlot>) => {
    setSaved(null);
    setSlotsDraft(slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  };

  const save = () => {
    const valid = slots.filter(isValidDailySlot);
    const dropped = slots.length - valid.length;
    setSlots.mutate(serializeDailySlots(valid));
    setLimit.mutate(String(limitMinutes));
    setSlotsDraft(valid);
    setSaved(
      dropped > 0
        ? `已保存；有 ${dropped} 段时间不合法，已忽略。`
        : "已保存。",
    );
  };

  return (
    <section className="space-y-3 rounded-2xl border border-white/5 bg-surface-2/80 p-4">
      <h2 className="font-display text-lg">每日可用时段</h2>
      <p className="text-xs text-ink-muted">
        先定好每天什么时候能学、能学多久。一键排期和「今日剩余待学」都会按这里算。
      </p>

      <ul className="space-y-2">
        {slots.length === 0 ? (
          <li className="text-sm text-ink-muted">还没有时段，点「添加时段」或选一个预设。</li>
        ) : null}
        {slots.map((slot, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2">
            <input
              type="time"
              aria-label={`第 ${index + 1} 段开始时间`}
              className="rounded-lg border border-white/10 bg-surface-3 px-2 py-1 text-sm"
              value={slot.start}
              onChange={(event) => updateSlot(index, { start: event.target.value })}
            />
            <span className="text-ink-muted">–</span>
            <input
              type="time"
              aria-label={`第 ${index + 1} 段结束时间`}
              className="rounded-lg border border-white/10 bg-surface-3 px-2 py-1 text-sm"
              value={slot.end}
              onChange={(event) => updateSlot(index, { end: event.target.value })}
            />
            <button
              type="button"
              aria-label={`删除第 ${index + 1} 段`}
              className="rounded-lg border border-white/15 px-2 py-1 text-xs"
              onClick={() => {
                setSaved(null);
                setSlotsDraft(slots.filter((_, i) => i !== index));
              }}
            >
              删除
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-sm"
          onClick={() => {
            setSaved(null);
            setSlotsDraft([...slots, { start: "09:00", end: "10:00" }]);
          }}
        >
          添加时段
        </button>
        {DAILY_SLOT_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm"
            onClick={() => {
              setSaved(null);
              setSlotsDraft(preset.slots.map((slot) => ({ ...slot })));
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-ink-muted">
        一天共 {dailySlotMinutes(slots)} 分钟可用。
      </p>

      <div className="space-y-1">
        <label htmlFor="daily-limit-hours" className="block text-sm">
          每日学习上限（小时）
        </label>
        <input
          id="daily-limit-hours"
          type="number"
          min={1}
          max={MAX_DAILY_STUDY_MINUTES / 60}
          step={0.5}
          className="w-32 rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
          value={limitMinutes / 60}
          onChange={(event) => {
            setSaved(null);
            const hours = Number(event.target.value);
            if (!Number.isFinite(hours)) return;
            setLimitDraft(parseDailyLimit(String(Math.round(hours * 60))));
          }}
        />
        <p className="text-xs text-ink-muted">
          「今日剩余待学」按这个数封顶，最多 {MAX_DAILY_STUDY_MINUTES / 60} 小时。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-lg bg-accent px-3 py-2 text-sm text-white"
          onClick={save}
        >
          保存时段
        </button>
        {saved ? <span className="text-xs text-ink-muted">{saved}</span> : null}
      </div>
    </section>
  );
}
