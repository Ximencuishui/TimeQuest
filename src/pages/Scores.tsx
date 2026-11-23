import { useMemo, useState } from "react";
import { Modal } from "../components/Modal";
import { ScoreTrendChart } from "../components/ScoreTrendChart";
import { useExamSessionMutations, useExamSessions } from "../hooks/useExamSessions";
import { useGoals } from "../hooks/useGoals";
import { useSubjects } from "../hooks/useSubjects";
import { useUserProfile } from "../hooks/useUserProfile";
import { todayStr } from "../lib/date";
import {
  digitsOnlyScore,
  emptyExamScores,
  examScoreWarning,
  filledScoreSum,
  parseExamDraft,
  type ExamScoreDraft,
} from "../lib/examRecord";
import { DEFAULT_USER_PROFILE, profileLine } from "../lib/profile";
import { resolvePrimaryGoal } from "../lib/goals";
import { examScoreBreakdown, scaledTotalNote } from "../lib/scoreScaling";
import type { ScoreTargets } from "../lib/scoreTrend";
import { sessionScore } from "../lib/subjects";
import type { ExamSession, Subject } from "../types";

function ExamEntryDialog({
  open,
  onClose,
  subjects,
}: {
  open: boolean;
  onClose: () => void;
  subjects: Subject[];
}) {
  const { data } = useUserProfile();
  const { create } = useExamSessionMutations();
  const profile = data ?? DEFAULT_USER_PROFILE;
  const line = profileLine(profile.grade, profile.region);
  const [examName, setExamName] = useState("");
  const [examDate, setExamDate] = useState(todayStr);
  const [scores, setScores] = useState<ExamScoreDraft>(() => emptyExamScores(subjects));
  const [error, setError] = useState("");
  const parsed = parseExamDraft({ examName, examDate, scores, subjects });
  const warning = examScoreWarning(scores, subjects);

  const setScore = (key: string, value: string) => {
    setError("");
    setScores((current) => ({ ...current, [key]: digitsOnlyScore(value) }));
  };

  const onSubmit = async () => {
    if (!parsed.ok) return;
    setError("");
    try {
      await create.mutateAsync(parsed.payload);
      onClose();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Modal open={open} title="录入新成绩" onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        <p className="text-sm text-ink-muted">
          {line ? `按你的档案（${line}）录入这 ${subjects.length} 科。` : `录入这 ${subjects.length} 科。`}
          没考的科目留空——留空就是缺考，总分会按已考科目比例折算。
        </p>
        <label htmlFor="exam-name" className="block text-sm">
          考试名称
          <input
            id="exam-name"
            className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
            placeholder="如 2026届高三上期中考"
            value={examName}
            onChange={(event) => {
              setError("");
              setExamName(event.target.value);
            }}
          />
        </label>
        <label htmlFor="exam-date" className="block text-sm">
          考试日期
          <input
            id="exam-date"
            type="date"
            className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
            value={examDate}
            onChange={(event) => {
              setError("");
              setExamDate(event.target.value);
            }}
          />
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {subjects.map((subject) => (
            <label key={subject.key} htmlFor={`score-${subject.key}`} className="block text-sm">
              {subject.label}
              <input
                id={`score-${subject.key}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={3}
                placeholder={subject.goal == null ? "未设目标" : `目标 ${subject.goal}`}
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
                value={scores[subject.key] ?? ""}
                onChange={(event) => setScore(subject.key, event.target.value)}
              />
            </label>
          ))}
        </div>
        <p className="text-sm text-zinc-400">
          {parsed.ok ? "留空的科目会记为未考。" : parsed.message}
        </p>
        {parsed.ok && warning ? <p className="text-sm text-amber-400">{warning}</p> : null}
        <button
          type="submit"
          className="rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-40"
          disabled={!parsed.ok || create.isPending}
        >
          保存成绩
        </button>
        {error ? <p className="text-sm text-ink-muted">{error}</p> : null}
      </form>
    </Modal>
  );
}

function RecordCard({
  session,
  subjects,
  onDelete,
}: {
  session: ExamSession;
  subjects: Subject[];
  onDelete: (session: ExamSession) => void;
}) {
  const { count, sum } = filledScoreSum(session, subjects);
  const breakdown = examScoreBreakdown(session, subjects);
  const note = scaledTotalNote(session, subjects);
  return (
    <article className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg">{session.name}</h2>
          <p className="mt-1 text-xs text-ink-muted">
            {session.date} · 已填 {count} 科 · 合计 {sum}
          </p>
          {note ? (
            <p className="mt-1 text-xs text-ink-muted" data-testid="scaled-total-note">
              {note}
            </p>
          ) : null}
          {breakdown.missing.length > 0 ? (
            <p className="mt-1 text-xs text-amber-300">
              缺考 {breakdown.missing.map((m) => m.label).join("、")}
              {breakdown.scaledTotal != null && breakdown.filled.length >= 2
                ? " · 按已考科目比例折算，可与总分目标直接比"
                : " · 只记了一科时不折算"}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="text-sm text-ink-muted hover:text-ink"
          onClick={() => onDelete(session)}
        >
          删除
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
        {subjects.map((subject) => (
          <div key={subject.id}>
            <dt className="text-xs text-ink-muted">{subject.label}</dt>
            <dd>{sessionScore(session, subject) ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function Scores() {
  const { data: sessions = [], isLoading, isError } = useExamSessions();
  const { data: subjects = [] } = useSubjects();
  const { data: profile } = useUserProfile();
  const { data: goals = [] } = useGoals();
  const { remove } = useExamSessionMutations();
  const [open, setOpen] = useState(false);
  const line = profile ? profileLine(profile.grade, profile.region) : "";

  // 总分目标的权威源是主目标的 `target_score`（4.0 起目标落在 `goals` 表）。
  // 旧库还没回填时退回档案的 `total_target`，别让目标线凭空消失。
  const primaryGoal = resolvePrimaryGoal(goals);
  const targets = useMemo<ScoreTargets>(() => {
    const next: ScoreTargets = {
      total: primaryGoal?.targetScore ?? profile?.total_target ?? null,
    };
    for (const subject of subjects) next[subject.key] = subject.goal;
    return next;
  }, [primaryGoal, profile, subjects]);

  const onDelete = (session: ExamSession) => {
    if (window.confirm(`确认删除「${session.name}」？`)) {
      remove.mutate(session.id);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">成绩档案</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {line ? `${line} · 历次考试` : "历次考试"}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-accent px-3 py-2 text-sm text-white"
          onClick={() => setOpen(true)}
        >
          录入新成绩
        </button>
      </div>

      {open ? (
        <ExamEntryDialog
          open={open}
          onClose={() => setOpen(false)}
          subjects={subjects}
        />
      ) : null}

      {isLoading ? (
        <p className="text-sm text-ink-muted">加载中…</p>
      ) : isError ? (
        <p className="text-sm text-ink-muted">成绩列表暂时读不出来。</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-ink-muted">
          还没有成绩记录。记下一次考试后，这里会画出和目标的距离。
        </p>
      ) : (
        <div className="space-y-3">
          {profile ? (
            <ScoreTrendChart sessions={sessions} subjects={subjects} targets={targets} />
          ) : (
            <p className="text-sm text-ink-muted">目标分还没读到，趋势图先等等。</p>
          )}
          {sessions.map((session) => (
            <RecordCard
              key={session.id}
              session={session}
              subjects={subjects}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
