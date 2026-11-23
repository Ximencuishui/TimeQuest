import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import { useAppSetting, useSetSetting } from "../hooks/useAppSetting";
import { usePlugins } from "../hooks/usePlugins";
import { useSubjects } from "../hooks/useSubjects";
import { useUpdateUserProfile, useUserProfile } from "../hooks/useUserProfile";
import { RegionSelect } from "./RegionSelect";
import {
  DEFAULT_USER_PROFILE,
  GRADES,
  canonicalProvince,
} from "../lib/profile";
import {
  TRACK_TEMPLATES,
  dateRuleFromPackages,
  mergeTemplateSubjects,
  resolveTemplateDate,
  templateNeedsGrade,
  trackTemplateById,
  type TrackTemplateId,
} from "../lib/track";
import type { UserProfile } from "../types";

export const ONBOARDING_KEY = "onboarding_completed";

/**
 * 目标分上限由赛道模板的满分决定，不再写死 750。
 *
 * maxScore 为 0 表示这条赛道不计总分（纯值计赛道）。
 */
function parseTarget(raw: string, maxScore: number): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1) return null;
  if (maxScore > 0 && value > maxScore) return null;
  return value;
}

/** 自定义赛道没有年级规则，默认给半年后的日期。 */
function defaultCustomDate(now: Date = new Date()): string {
  const date = new Date(now.getTime());
  date.setMonth(date.getMonth() + 6);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function OnboardingGate() {
  const setting = useAppSetting(ONBOARDING_KEY);
  const profile = useUserProfile();
  if (setting.isLoading || setting.isError) return null;
  if (setting.data === "1") return null;
  if (profile.isLoading) return null;
  return <Onboarding initial={profile.data ?? DEFAULT_USER_PROFILE} />;
}

function Onboarding({ initial }: { initial: UserProfile }) {
  const update = useUpdateUserProfile();
  const setCompleted = useSetSetting(ONBOARDING_KEY);
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [templateId, setTemplateId] = useState<TrackTemplateId>("gaokao");
  const template = trackTemplateById(templateId);
  // 科目清单 = 模板给的 + 库里已有的（库里改过的目标优先）。
  // 引导时不带出库里多出来的科目：用户还没选定赛道。
  const { data: storedSubjects = [] } = useSubjects();
  // 赛道包：装上就多一条赛道、一套科目和一组目标（含日期规则）。
  const plugins = usePlugins();
  const subjectRows = useMemo(
    () => mergeTemplateSubjects(template, storedSubjects, false),
    [template, storedSubjects],
  );
  const [grade, setGrade] = useState(
    (GRADES as readonly string[]).includes(initial.grade) ? initial.grade : "高三",
  );
  const [region, setRegion] = useState(canonicalProvince(initial.region) ?? initial.region);
  const [goalName, setGoalName] = useState(template.goalName);
  const [target, setTarget] = useState(
    template.requiresGaokaoContext ? String(initial.total_target || "") : "",
  );
  const [subjectGoals, setSubjectGoals] = useState<Record<string, string>>(() =>
    Object.fromEntries(subjectRows.map((subject) => [subject.key, String(subject.goal)])),
  );
  // 用户手动改过日期之后，就不再跟着年级自动算了。
  const [dateOverride, setDateOverride] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const score = parseTarget(target, template.maxScore);
  const regionOk = canonicalProvince(region) != null;
  const needsRegion = template.requiresGaokaoContext;
  const needsGrade = templateNeedsGrade(template, plugins.data ?? []);
  // 目标日期的规则以赛道包为准，没装包就用内置模板里的那份。
  const packageRule = useMemo(
    () => dateRuleFromPackages(plugins.data ?? [], template.name),
    [plugins.data, template.name],
  );
  const defaultDate =
    resolveTemplateDate(template, packageRule, grade) || defaultCustomDate();
  const goalDate = dateOverride ?? defaultDate;
  const nameOk = goalName.trim().length > 0;
  const scoreOk = !target.trim() || score != null;
  const stepTwoOk = nameOk && scoreOk && goalDate.length > 0 && (!needsRegion || regionOk);

  const pickTemplate = (id: TrackTemplateId) => {
    const next = trackTemplateById(id);
    // 占位模板（考研 / 语言 / 技能）还没落地，先走自定义分支。
    const effective = next.available ? next : trackTemplateById("custom");
    setTemplateId(effective.id);
    setGoalName(effective.goalName);
    setTarget(
      effective.requiresGaokaoContext ? String(initial.total_target || "") : "",
    );
    setDateOverride(null);
    setSubjectGoals(
      Object.fromEntries(
        mergeTemplateSubjects(effective, storedSubjects, false).map((subject) => [
          subject.key,
          String(subject.goal),
        ]),
      ),
    );
  };

  const finish = async (loadMock: boolean) => {
    if (!stepTwoOk) return;
    setBusy(true);
    setError("");
    try {
      if (template.requiresGaokaoContext) {
        await update.mutateAsync({
          ...initial,
          grade,
          region: canonicalProvince(region) ?? region.trim(),
          // 按用户填的来：没填就是「这条赛道不计总分」。
          // 不能拿旧档案里的默认值顶上去——那是上一条赛道的分值。
          total_target: score,
        });
      }
      // 引导选的赛道要真的建出来：只换科目模板的话，库里还是那条「高考」，
      // 赛道名和科目集自相矛盾，设置里也看不到这条赛道。
      const tracks = (await api.listTracks()) ?? [];
      const existing = tracks.find((item) => item.name === template.name);
      const track = await api.upsertTrack({
        id: existing?.id ?? null,
        name: template.name,
        kind: template.kind,
        // 不计总分的赛道（技能习得这类）按分科计。
        scoreMode: template.maxScore > 0 ? "total" : "per_subject",
        isPrimary: true,
        color: null,
      });
      const trackId = track.id;

      // 各科目标落在科目字典，不跟档案一起存。每条赛道都要播种自己的科目。
      // 科目标识全库唯一：已存在的带上 id 改，不存在的才新建。
      const existingSubjects = (await api.listSubjects()) ?? [];
      const subjectIds = new Map(existingSubjects.map((item) => [item.key, item.id]));
      for (const subject of subjectRows) {
        const raw = subjectGoals[subject.key]?.trim() ?? "";
        const goal = /^\d+$/.test(raw) ? Number(raw) : subject.goal;
        await api.upsertSubject({
          id: subjectIds.get(subject.key) ?? null,
          trackId,
          key: subject.key,
          label: subject.label,
          fullMark: subject.fullMark,
          goal,
          unit: subject.unit,
        });
      }

      const goals = await api.listGoals();
      const primary = goals.find((item) => item.isPrimary) ?? goals[0];
      await api.upsertGoal({
        id: primary?.id,
        trackId,
        name: goalName.trim(),
        date: goalDate,
        kind: primary?.kind ?? "exam",
        isPrimary: true,
        targetScore: score,
      });

      if (loadMock) await api.generateMockData();
      await setCompleted.mutateAsync("1");
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      await qc.invalidateQueries({ queryKey: ["sessions"] });
      await qc.invalidateQueries({ queryKey: ["sessions-range"] });
      await qc.invalidateQueries({ queryKey: ["user-stats"] });
      await qc.invalidateQueries({ queryKey: ["examSessions"] });
      await qc.invalidateQueries({ queryKey: ["goals"] });
      await qc.invalidateQueries({ queryKey: ["subjects"] });
      await qc.invalidateQueries({ queryKey: ["tracks"] });
      await qc.invalidateQueries({ queryKey: ["hasMockData"] });
      await qc.invalidateQueries({ queryKey: ["stats"] });
    } catch (cause) {
      setError(String(cause));
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 overflow-auto bg-surface text-ink"
    >
      <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-sm text-accent-soft">TimeQuest</p>

        {step === 1 ? (
          <>
            <h1 id="onboarding-title" className="mt-2 font-display text-3xl">
              你在为什么努力
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              选一条学习方向。后续随时可以在设置里改。
            </p>
            <div className="mt-8 grid gap-3">
              {TRACK_TEMPLATES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={templateId === item.id}
                  className={`rounded-xl border px-4 py-3 text-left ${
                    templateId === item.id
                      ? "border-accent bg-surface-3"
                      : "border-white/10 bg-surface-2"
                  }`}
                  onClick={() => pickTemplate(item.id)}
                >
                  <span className="block text-sm text-ink">{item.name}</span>
                  <span className="mt-1 block text-xs text-ink-muted">{item.tagline}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-8 rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
              onClick={() => setStep(2)}
            >
              下一步
            </button>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h1 id="onboarding-title" className="mt-2 font-display text-3xl">
              定下目标
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              目标名称和日期会出现在首页倒计时里，随时能改。
            </p>

            {needsGrade ? (
              <fieldset className="mt-8">
                <legend className="text-sm">年级</legend>
                <div className="mt-2 flex gap-2">
                  {GRADES.map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={grade === item}
                      className={`rounded-lg px-4 py-2 text-sm ${
                        grade === item
                          ? "bg-accent text-white"
                          : "border border-white/15 text-ink-muted"
                      }`}
                      onClick={() => setGrade(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {needsRegion ? (
              <>
                <label htmlFor="onboarding-region" className="mt-5 block text-sm">
                  地区
                </label>
                <RegionSelect
                  id="onboarding-region"
                  value={region}
                  onChange={setRegion}
                />
              </>
            ) : null}

            <label htmlFor="onboarding-goal-name" className="mt-5 block text-sm">
              目标名称
            </label>
            <input
              id="onboarding-goal-name"
              className="mt-2 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
              value={goalName}
              onChange={(event) => setGoalName(event.target.value)}
            />

            <label htmlFor="onboarding-goal-date" className="mt-5 block text-sm">
              目标日期
            </label>
            <input
              id="onboarding-goal-date"
              type="date"
              className="mt-2 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
              value={goalDate}
              onChange={(event) => setDateOverride(event.target.value)}
            />
            {needsGrade ? (
              <p className="mt-2 text-xs text-ink-muted">预计考试日 {defaultDate}</p>
            ) : null}

            <label htmlFor="onboarding-target" className="mt-5 block text-sm">
              总分目标
            </label>
            <input
              id="onboarding-target"
              inputMode="numeric"
              className="mt-2 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
              placeholder={template.maxScore > 0 ? `1–${template.maxScore}` : "可留空"}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />

            {subjectRows.length > 0 ? (
              <div className="mt-5">
                <p className="text-sm">各科目标</p>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {subjectRows.map((subject) => (
                    <label
                      key={subject.key}
                      className="block text-sm"
                      htmlFor={`onboarding-subject-${subject.key}`}
                    >
                      {subject.label}
                      <input
                        id={`onboarding-subject-${subject.key}`}
                        inputMode="numeric"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
                        value={subjectGoals[subject.key] ?? ""}
                        onChange={(event) =>
                          setSubjectGoals((current) => ({
                            ...current,
                            [subject.key]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {!stepTwoOk ? (
              <p className="mt-3 text-sm text-ink-muted">
                {needsRegion && !regionOk
                  ? "请从列表中选择地区。"
                  : !nameOk
                    ? "请填写目标名称。"
                    : `总分目标需要是 1 到 ${template.maxScore} 的整数。`}
              </p>
            ) : null}

            <button
              type="button"
              className="mt-8 rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
              disabled={!stepTwoOk}
              onClick={() => setStep(3)}
            >
              下一步
            </button>
            <button
              type="button"
              className="mt-4 text-sm text-ink-muted"
              onClick={() => setStep(1)}
            >
              返回
            </button>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h1 id="onboarding-title" className="mt-2 font-display text-3xl">
              怎么开始
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              {goalName.trim()} · {goalDate}
              {score != null ? ` · 目标 ${score} 分` : ""}
            </p>
            <div className="mt-8 flex flex-col gap-3">
              <button
                type="button"
                className="rounded-lg bg-accent px-4 py-3 text-sm text-white disabled:opacity-40"
                disabled={busy}
                onClick={() => void finish(false)}
              >
                开启真实记录（推荐）
              </button>
              {template.requiresGaokaoContext ? (
                <button
                  type="button"
                  className="rounded-lg border border-white/15 px-4 py-3 text-sm disabled:opacity-40"
                  disabled={busy}
                  onClick={() => void finish(true)}
                >
                  加载湖南高二演示数据
                </button>
              ) : null}
            </div>
            <p className="mt-4 text-sm text-ink-muted">
              演示数据会单独标记。之后可以在设置的「数据管理」里一键清除，已经记下的真实记录会留下来。
            </p>
            {error ? <p className="mt-3 text-sm text-accent-soft">{error}</p> : null}
            <button
              type="button"
              className="mt-6 text-sm text-ink-muted"
              disabled={busy}
              onClick={() => setStep(2)}
            >
              返回
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
