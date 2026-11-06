import { useState } from "react";
import { Modal } from "../components/Modal";
import { ScoreTrendChart } from "../components/ScoreTrendChart";
import { useExamRecordMutations, useExamRecords } from "../hooks/useExamRecords";
import { useUserProfile } from "../hooks/useUserProfile";
import { todayStr } from "../lib/date";
import {
  digitsOnlyScore,
  emptyExamScores,
  EXAM_SCORE_FIELDS,
  examScoreWarning,
  filledScoreSum,
  parseExamDraft,
  type ExamScoreDraft,
  type ExamScoreKey,
} from "../lib/examRecord";
import { DEFAULT_USER_PROFILE, profileLine } from "../lib/profile";
import type { ExamRecord } from "../types";

function ExamEntryDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data } = useUserProfile();
  const { create } = useExamRecordMutations();
  const profile = data ?? DEFAULT_USER_PROFILE;
  const line = profileLine(profile.grade, profile.region);
  const [examName, setExamName] = useState("");
  const [examDate, setExamDate] = useState(todayStr);
  const [scores, setScores] = useState<ExamScoreDraft>(emptyExamScores);
  const [error, setError] = useState("");
  const parsed = parseExamDraft({ examName, examDate, scores });
  const warning = examScoreWarning(scores);

  const setScore = (key: ExamScoreKey, value: string) => {
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
          {line ? `按你的档案（${line}）录入这六科。` : "录入这六科。"}
          没考的科目留空。
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
          {EXAM_SCORE_FIELDS.map((field) => (
            <label key={field.key} htmlFor={`score-${field.key}`} className="block text-sm">
              {field.label}
              <input
                id={`score-${field.key}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={3}
                placeholder={`目标 ${profile.subject_targets[field.subject]}`}
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
                value={scores[field.key]}
                onChange={(event) => setScore(field.key, event.target.value)}
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
  record,
  onDelete,
}: {
  record: ExamRecord;
  onDelete: (record: ExamRecord) => void;
}) {
  const { count, sum } = filledScoreSum(record);
  return (
    <article className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg">{record.exam_name}</h2>
          <p className="mt-1 text-xs text-ink-muted">
            {record.exam_date} · 已填 {count} 科 · 合计 {sum}
          </p>
        </div>
        <button
          type="button"
          className="text-sm text-ink-muted hover:text-ink"
          onClick={() => onDelete(record)}
        >
          删除
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
        {EXAM_SCORE_FIELDS.map((field) => (
          <div key={field.key}>
            <dt className="text-xs text-ink-muted">{field.label}</dt>
            <dd>{record[field.key] ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function Scores() {
  const { data: records = [], isLoading, isError } = useExamRecords();
  const { data: profile } = useUserProfile();
  const { remove } = useExamRecordMutations();
  const [open, setOpen] = useState(false);
  const line = profile ? profileLine(profile.grade, profile.region) : "";

  const onDelete = (record: ExamRecord) => {
    if (window.confirm(`确认删除「${record.exam_name}」？`)) {
      remove.mutate(record.id);
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
        <ExamEntryDialog open={open} onClose={() => setOpen(false)} />
      ) : null}

      {isLoading ? (
        <p className="text-sm text-ink-muted">加载中…</p>
      ) : isError ? (
        <p className="text-sm text-ink-muted">成绩列表暂时读不出来。</p>
      ) : records.length === 0 ? (
        <p className="text-sm text-ink-muted">
          还没有成绩记录。记下一次考试后，这里会画出和目标的距离。
        </p>
      ) : (
        <div className="space-y-3">
          {profile ? (
            <ScoreTrendChart
              records={records}
              targets={{ total: profile.total_target, ...profile.subject_targets }}
            />
          ) : (
            <p className="text-sm text-ink-muted">目标分还没读到，趋势图先等等。</p>
          )}
          {records.map((record) => (
            <RecordCard key={record.id} record={record} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
