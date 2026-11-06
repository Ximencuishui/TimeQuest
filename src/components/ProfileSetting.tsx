import { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useUpdateUserProfile, useUserProfile } from "../hooks/useUserProfile";
import { gaokaoDateForGrade } from "../lib/examDate";
import { useUiStore } from "../store/ui";
import type { UserProfile } from "../types";
import { RegionSelect } from "./RegionSelect";
import {
  DEFAULT_USER_PROFILE,
  GRADES,
  parseProfileDraft,
  profileToDraft,
  SUBJECT_FIELDS,
  subjectTargetSum,
  targetHint,
  type ProfileDraft,
  type SubjectKey,
} from "../lib/profile";

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: mime });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

function shrinkDataUrl(dataUrl: string, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height, 1));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("图片无法读取"));
    img.src = dataUrl;
  });
}

async function fileToAvatar(bytes: Uint8Array, mime: string): Promise<string> {
  const dataUrl = await bytesToDataUrl(bytes, mime);
  try {
    return await shrinkDataUrl(dataUrl);
  } catch {
    return dataUrl;
  }
}

export function ProfileSetting() {
  const { data } = useUserProfile();
  const update = useUpdateUserProfile();
  const upsertExam = useUiStore((s) => s.upsertExam);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [error, setError] = useState("");
  const [pendingExamDate, setPendingExamDate] = useState<string | null>(null);
  const view = draft ?? profileToDraft(data ?? DEFAULT_USER_PROFILE);
  const parsed = parseProfileDraft(view);
  const savedGrade = (data ?? DEFAULT_USER_PROFILE).grade;

  const edit = (patch: Partial<ProfileDraft>) => {
    setError("");
    setDraft({ ...view, ...patch });
  };

  const editSubject = (key: SubjectKey, value: string) => {
    edit({ subjects: { ...view.subjects, [key]: value } });
  };

  const applyAvatar = (avatar: string | null) => {
    edit({ avatar });
  };

  const onPick = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        ],
      });
      if (typeof selected !== "string" || !selected) return;
      const bytes = await readFile(selected);
      applyAvatar(await fileToAvatar(bytes, mimeFromPath(selected)));
    } catch {
      fileRef.current?.click();
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    applyAvatar(await fileToAvatar(bytes, file.type || "image/png"));
  };

  const writeExamDate = (date: string) => {
    const exams = useUiStore.getState().exams;
    const primary = exams.find((item) => item.isPrimary) ?? exams[0];
    upsertExam({
      id: primary?.id ?? "gaokao",
      name: primary?.name ?? "高考",
      date,
      isPrimary: true,
    });
  };

  const saveProfile = async (profile: UserProfile, examDate: string | null) => {
    await update.mutateAsync(profile);
    if (examDate) writeExamDate(examDate);
    setDraft(null);
    setPendingExamDate(null);
  };

  const onSave = async () => {
    if (!parsed.ok) return;
    setError("");
    const nextDate = gaokaoDateForGrade(parsed.profile.grade);
    const primary =
      useUiStore.getState().exams.find((item) => item.isPrimary) ??
      useUiStore.getState().exams[0];
    const gradeChanged = parsed.profile.grade !== savedGrade;
    if (gradeChanged && primary?.date !== nextDate) {
      setPendingExamDate(nextDate);
      return;
    }
    try {
      await saveProfile(parsed.profile, null);
    } catch (e) {
      setError(String(e));
    }
  };

  const confirmGradeDate = async () => {
    if (!parsed.ok || !pendingExamDate) return;
    setError("");
    try {
      await saveProfile(parsed.profile, pendingExamDate);
    } catch (e) {
      setError(String(e));
    }
  };

  const dismissGradePrompt = () => {
    const saved = data ?? DEFAULT_USER_PROFILE;
    setPendingExamDate(null);
    setDraft((current) => {
      const base = current ?? profileToDraft(saved);
      return { ...base, grade: saved.grade };
    });
  };

  const hint = parsed.ok
    ? targetHint(
        subjectTargetSum(parsed.profile.subject_targets),
        parsed.profile.total_target,
      )
    : parsed.message;

  return (
    <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
      <h2 className="font-display text-lg">个人档案</h2>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave();
        }}
      >
        <div className="flex items-center gap-4">
          <button
            type="button"
            aria-label="上传头像"
            className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-surface-3 text-xs text-ink-muted"
            onClick={() => void onPick()}
          >
            {view.avatar ? (
              <img src={view.avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              "上传"
            )}
          </button>
          <div className="min-w-0 text-sm text-ink-muted">
            <p>点击头像选择图片，保存后写入档案。</p>
            {view.avatar ? (
              <button
                type="button"
                className="mt-1 text-xs text-ink hover:underline"
                onClick={() => applyAvatar(null)}
              >
                移除头像
              </button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void onFile(file);
            }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor="profile-grade" className="block text-sm">
            年级
            <select
              id="profile-grade"
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
              value={view.grade}
              onChange={(event) => edit({ grade: event.target.value })}
            >
              {(GRADES as readonly string[]).includes(view.grade) ? null : (
                <option value={view.grade}>{view.grade || "未选择"}</option>
              )}
              {GRADES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="profile-region" className="block text-sm">
            地区
            <RegionSelect
              id="profile-region"
              value={view.region}
              onChange={(region) => edit({ region })}
            />
          </label>
        </div>

        <div>
          <label htmlFor="profile-total-target" className="block text-sm">
            总分目标
            <input
              id="profile-total-target"
              inputMode="numeric"
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
              value={view.totalTarget}
              onChange={(event) => edit({ totalTarget: event.target.value })}
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SUBJECT_FIELDS.map((field) => (
              <label key={field.key} className="block text-sm" htmlFor={`target-${field.key}`}>
                {field.label}
                <input
                  id={`target-${field.key}`}
                  inputMode="numeric"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
                  value={view.subjects[field.key]}
                  onChange={(event) => editSubject(field.key, event.target.value)}
                />
              </label>
            ))}
          </div>
          <p id="subject-target-hint" className="mt-3 text-sm text-zinc-400">
            {hint}
          </p>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-40"
          disabled={!parsed.ok || update.isPending}
        >
          保存档案
        </button>
        {pendingExamDate ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="grade-exam-date-title"
            className="rounded-xl border border-white/10 bg-surface p-3 text-sm"
          >
            <p id="grade-exam-date-title">年级会改高考日期</p>
            <p className="mt-1 text-ink-muted">
              年级改为「{view.grade}」后，高考倒计时将改为 {pendingExamDate}。
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white"
                onClick={() => void confirmGradeDate()}
              >
                更新高考日期
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm"
                onClick={dismissGradePrompt}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
        {error ? <p className="text-sm text-ink-muted">{error}</p> : null}
      </form>
    </section>
  );
}
