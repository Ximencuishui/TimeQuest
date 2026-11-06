import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import { useAppSetting, useSetSetting } from "../hooks/useAppSetting";
import { useUpdateUserProfile, useUserProfile } from "../hooks/useUserProfile";
import { RegionSelect } from "./RegionSelect";
import { gaokaoDateForGrade } from "../lib/examDate";
import { DEFAULT_USER_PROFILE, GRADES, canonicalProvince } from "../lib/profile";
import { useUiStore } from "../store/ui";
import type { UserProfile } from "../types";

export const ONBOARDING_KEY = "onboarding_completed";

function parseTarget(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1 || value > 750) return null;
  return value;
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
  const [step, setStep] = useState<1 | 2>(1);
  const [grade, setGrade] = useState(
    (GRADES as readonly string[]).includes(initial.grade) ? initial.grade : "高三",
  );
  const [region, setRegion] = useState(canonicalProvince(initial.region) ?? initial.region);
  const [target, setTarget] = useState(String(initial.total_target || ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const score = parseTarget(target);
  const regionOk = canonicalProvince(region) != null;
  const stepOneOk = regionOk && score != null;
  const examDate = gaokaoDateForGrade(grade);

  const finish = async (loadMock: boolean) => {
    if (!stepOneOk || score == null) return;
    setBusy(true);
    setError("");
    try {
      await update.mutateAsync({
        ...initial,
        grade,
        region: canonicalProvince(region) ?? region.trim(),
        total_target: score,
      });
      const examDate = gaokaoDateForGrade(grade);
      const exams = useUiStore.getState().exams;
      const primary = exams.find((item) => item.isPrimary) ?? exams[0];
      useUiStore.getState().upsertExam({
        id: primary?.id ?? "gaokao",
        name: primary?.name ?? "高考",
        date: examDate,
        isPrimary: true,
      });
      if (loadMock) await api.generateMockData();
      await setCompleted.mutateAsync("1");
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      await qc.invalidateQueries({ queryKey: ["sessions"] });
      await qc.invalidateQueries({ queryKey: ["sessions-range"] });
      await qc.invalidateQueries({ queryKey: ["user-stats"] });
      await qc.invalidateQueries({ queryKey: ["examRecords"] });
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
              开始之前
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              告诉我年级、地区和高考目标分。这些可以稍后在设置里改。
            </p>
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
              <p className="mt-3 text-sm text-ink-muted">预计高考日 {examDate}</p>
            </fieldset>
            <label htmlFor="onboarding-region" className="mt-5 block text-sm">
              地区
            </label>
            <RegionSelect id="onboarding-region" value={region} onChange={setRegion} />
            <label htmlFor="onboarding-target" className="mt-5 block text-sm">
              高考目标分
            </label>
            <input
              id="onboarding-target"
              inputMode="numeric"
              className="mt-2 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
              placeholder="1–750"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
            {!stepOneOk ? (
              <p className="mt-3 text-sm text-ink-muted">
                请选择地区，以及 1 到 750 的整数目标分。
              </p>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">各科目标可以稍后在设置里调整。</p>
            )}
            <button
              type="button"
              className="mt-8 rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
              disabled={!stepOneOk}
              onClick={() => setStep(2)}
            >
              下一步
            </button>
          </>
        ) : (
          <>
            <h1 id="onboarding-title" className="mt-2 font-display text-3xl">
              怎么开始
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              {grade} · {canonicalProvince(region) ?? region.trim()} · 目标 {score} 分 · 高考日 {examDate}
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
              <button
                type="button"
                className="rounded-lg border border-white/15 px-4 py-3 text-sm disabled:opacity-40"
                disabled={busy}
                onClick={() => void finish(true)}
              >
                加载湖南高二演示数据
              </button>
            </div>
            <p className="mt-4 text-sm text-ink-muted">
              演示数据会单独标记。之后可以在设置的「数据管理」里一键清除，已经记下的真实记录会留下来。
            </p>
            {error ? <p className="mt-3 text-sm text-accent-soft">{error}</p> : null}
            <button
              type="button"
              className="mt-6 text-sm text-ink-muted"
              disabled={busy}
              onClick={() => setStep(1)}
            >
              返回
            </button>
          </>
        )}
      </div>
    </div>
  );
}
