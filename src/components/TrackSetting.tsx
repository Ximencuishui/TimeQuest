import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import { useActiveTrack, useTrackMutations, useTracks } from "../hooks/useTracks";
import { useGoalMutations, useGoals } from "../hooks/useGoals";
import { resolvePrimaryGoal } from "../lib/goals";
import {
  TRACK_TEMPLATES,
  trackTemplateById,
  type TrackTemplateId,
} from "../lib/track";
import type { Track } from "../types";

const KIND_LABELS: Record<string, string> = {
  exam: "考试",
  skill: "技能",
  course: "课程",
};

/**
 * 学习方向（赛道）设置。
 *
 * 换赛道就是换一套科目 + 一套目标：
 * 切过去之后，个人档案里的科目清单与成绩页都会跟着换成这条赛道的。
 */
export function TrackSetting() {
  const { data: tracks = [] } = useTracks();
  const { track: active } = useActiveTrack();
  const { upsert, remove } = useTrackMutations();
  const { data: goals = [] } = useGoals();
  const { upsert: upsertGoal } = useGoalMutations();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<TrackTemplateId>("custom");
  const [msg, setMsg] = useState("");

  /** 主目标跟着主赛道走，否则倒计时会挂在上一条赛道上。 */
  const movePrimaryGoal = async (trackId: number) => {
    const primary = resolvePrimaryGoal(goals);
    if (!primary) return;
    await upsertGoal.mutateAsync({
      id: primary.id,
      trackId,
      name: primary.name,
      date: primary.date,
      kind: primary.kind,
      isPrimary: true,
      targetScore: primary.targetScore,
    });
  };

  const switchTo = async (track: Track) => {
    setMsg("");
    try {
      await upsert.mutateAsync({
        id: track.id,
        name: track.name,
        kind: track.kind,
        scoreMode: track.scoreMode,
        isPrimary: true,
      });
      await movePrimaryGoal(track.id);
      await queryClient.invalidateQueries({ queryKey: ["subjects"] });
      setMsg(`已切换到「${track.name}」。`);
    } catch (error) {
      setMsg(`切换失败：${String(error)}`);
    }
  };

  const create = async () => {
    const template = trackTemplateById(templateId);
    const title = name.trim() || template.name;
    setMsg("");
    try {
      const track = await upsert.mutateAsync({
        name: title,
        kind: template.kind,
        scoreMode: "total",
        isPrimary: true,
      });
      // 新赛道按模板铺一套科目；科目标识全库唯一，已存在的带上 id 改。
      const existingSubjects = (await api.listSubjects()) ?? [];
      const subjectIds = new Map(existingSubjects.map((item) => [item.key, item.id]));
      for (const subject of template.subjects) {
        await api.upsertSubject({
          id: subjectIds.get(subject.key) ?? null,
          trackId: track.id,
          key: subject.key,
          label: subject.label,
          fullMark: subject.fullMark,
          goal: subject.goal,
          unit: subject.unit ?? "分",
        });
      }
      await movePrimaryGoal(track.id);
      await queryClient.invalidateQueries({ queryKey: ["subjects"] });
      setName("");
      setMsg(`已切换到「${title}」。`);
    } catch (error) {
      setMsg(`创建失败：${String(error)}`);
    }
  };

  const drop = async (track: Track) => {
    if (!window.confirm(`删除赛道「${track.name}」？历史成绩会保留。`)) return;
    setMsg("");
    try {
      await remove.mutateAsync(track.id);
      await queryClient.invalidateQueries({ queryKey: ["subjects"] });
      setMsg(`已删除「${track.name}」。`);
    } catch (error) {
      setMsg(`删除失败：${String(error)}`);
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-white/5 bg-surface-2/80 p-4">
      <h2 className="font-display text-lg">学习方向</h2>
      <p className="text-xs text-ink-muted">
        一条赛道就是一套科目 + 一套目标。切换后，个人档案里的科目清单和成绩页都会跟着换。
      </p>

      <ul className="space-y-2">
        {tracks.map((track) => {
          const current = active?.id === track.id;
          return (
            <li
              key={track.id}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-3/60 px-3 py-2 text-sm"
            >
              <span className="font-medium text-ink">{track.name}</span>
              <span className="text-xs text-ink-muted">
                {KIND_LABELS[track.kind] ?? track.kind}
              </span>
              {current ? (
                <span className="rounded bg-accent/20 px-2 py-0.5 text-xs text-accent-soft">
                  当前
                </span>
              ) : null}
              {current ? null : (
                <button
                  type="button"
                  className="rounded border border-white/15 px-2 py-1 text-xs"
                  onClick={() => void switchTo(track)}
                >
                  切换
                </button>
              )}
              {tracks.length > 1 ? (
                <button
                  type="button"
                  className="text-xs text-ink-muted hover:text-ink"
                  onClick={() => void drop(track)}
                >
                  删除
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label htmlFor="track-template" className="block text-sm">
          模板
          <select
            id="track-template"
            className="mt-1 rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value as TrackTemplateId)}
          >
            {TRACK_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="track-name" className="block text-sm">
          名称
          <input
            id="track-name"
            className="mt-1 rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
            placeholder={trackTemplateById(templateId).name}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="rounded-lg bg-accent px-3 py-2 text-sm text-white"
          onClick={() => void create()}
        >
          新建并切换
        </button>
      </div>

      {msg ? <p className="text-sm text-ink-muted">{msg}</p> : null}
    </section>
  );
}
