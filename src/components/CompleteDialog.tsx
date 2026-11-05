import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import type { CompleteSessionResult, TaskSession } from "../types";
import { METHODS } from "../lib/constants";
import { todayStr } from "../lib/date";

type SubmitData = {
  actualUnits: number;
  selfRating: number;
  selfNote: string;
  method: string;
  deferRemaining: boolean;
  /** Only set when deferRemaining is true; otherwise null so backend skips remainder slot. */
  deferDate: string | null;
  deferStart: string | null;
  deferEnd: string | null;
};

type Props = {
  session: TaskSession | null;
  onClose: () => void;
  onSubmit: (
    data: SubmitData,
  ) => void | Promise<void | CompleteSessionResult>;
  busy?: boolean;
};

function xpAwardedFrom(result: void | CompleteSessionResult): number | undefined {
  if (result && typeof result === "object" && typeof result.xpAwarded === "number") {
    return result.xpAwarded;
  }
  return undefined;
}

/** Map backend ZeroUnitsCannotDefer (Display / variant name) to a short Chinese hint. */
export function mapCompleteSessionError(err: unknown): string {
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : err && typeof err === "object" && "error" in err
          ? String((err as { error: unknown }).error)
          : String(err ?? "");
  if (
    /ZeroUnitsCannotDefer/i.test(raw) ||
    /cannot defer remaining units/i.test(raw) ||
    /actual_units is 0/i.test(raw)
  ) {
    return "未完成任何单位，无法将剩余改到下次。请使用「改期」。";
  }
  return raw || "完成失败，请重试。";
}

export type ActualUnitsValidation = {
  valid: boolean;
  value: number | null;
  error: string | null;
};

/**
 * Parse the raw actual-units field.
 * Empty, non-numeric, negative, non-integer, and unsafe integers are invalid.
 * Only a canonical non-negative integer token (`/^\d+$/`) can be valid.
 */
export function validateActualUnits(raw: string): ActualUnitsValidation {
  const text = raw.trim();
  if (text === "") {
    return { valid: false, value: null, error: "请输入课数" };
  }
  if (/^-\d+$/.test(text)) {
    return { valid: false, value: null, error: "不能为负数" };
  }
  if (!/^\d+$/.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n)) {
      return { valid: false, value: null, error: "请输入数字" };
    }
    if (n < 0) {
      return { valid: false, value: null, error: "不能为负数" };
    }
    if (!Number.isInteger(n) || text.includes(".")) {
      return { valid: false, value: null, error: "请输入整数" };
    }
    if (!Number.isSafeInteger(n)) {
      return { valid: false, value: null, error: "数值过大" };
    }
    return { valid: false, value: null, error: "请输入整数" };
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n)) {
    return { valid: false, value: null, error: "数值过大" };
  }
  return { valid: true, value: n, error: null };
}

export function CompleteDialog({ session, onClose, onSubmit, busy }: Props) {
  const [actualUnitsRaw, setActualUnitsRaw] = useState("");
  const [selfRating, setSelfRating] = useState(3);
  const [selfNote, setSelfNote] = useState("");
  const [method, setMethod] = useState<string>(METHODS[1]);
  const [deferRemaining, setDeferRemaining] = useState(false);
  const [deferDate, setDeferDate] = useState(todayStr());
  const [deferStart, setDeferStart] = useState("19:00");
  const [deferEnd, setDeferEnd] = useState("20:00");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [overageHint, setOverageHint] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      setActualUnitsRaw(String(session.planned_units));
      setSelfRating(3);
      setSelfNote("");
      setDeferRemaining(false);
      setDeferDate(todayStr());
      setDeferStart("19:00");
      setDeferEnd("20:00");
      setSubmitError(null);
      setOverageHint(null);
    }
  }, [session]);

  if (!session) return null;
  const unitsCheck = validateActualUnits(actualUnitsRaw);
  const actualUnits = unitsCheck.value;
  const remaining =
    unitsCheck.valid && actualUnits != null
      ? Math.max(0, session.planned_units - actualUnits)
      : 0;
  // 0 单位不可 defer（引导改期）；部分完成才显示勾选。
  const canDefer =
    unitsCheck.valid &&
    actualUnits != null &&
    actualUnits > 0 &&
    actualUnits < session.planned_units;
  const showZeroHint =
    unitsCheck.valid && actualUnits === 0 && session.planned_units > 0;

  return (
    <Modal
      open
      title="完成排期"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-ink-muted hover:bg-white/5"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || overageHint != null || !unitsCheck.valid}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-soft disabled:opacity-50"
            onClick={() => {
              const check = validateActualUnits(actualUnitsRaw);
              if (!check.valid || check.value == null) return;
              const units = check.value;
              const defer = canDefer && deferRemaining;
              void (async () => {
                setSubmitError(null);
                try {
                  const result = await onSubmit({
                    actualUnits: units,
                    selfRating,
                    selfNote,
                    method,
                    deferRemaining: defer,
                    deferDate: defer ? deferDate : null,
                    deferStart: defer ? deferStart : null,
                    deferEnd: defer ? deferEnd : null,
                  });
                  const over = units - session.planned_units;
                  if (over > 0) {
                    const xp = xpAwardedFrom(result);
                    setOverageHint(
                      xp === undefined
                        ? `超额 ${over} 课`
                        : `超额 ${over} 课 · +${xp} XP`,
                    );
                  }
                } catch (err) {
                  setSubmitError(mapCompleteSessionError(err));
                }
              })();
            }}
          >
            确认完成
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-ink-muted">
          {session.task_title} · 计划 {session.planned_units} 课
        </p>
        <label className="block">
          <span className="text-ink-muted">实际课数</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={unitsCheck.error != null}
            className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
            value={actualUnitsRaw}
            onChange={(e) => {
              setActualUnitsRaw(e.target.value);
              setSubmitError(null);
            }}
          />
          {unitsCheck.error ? (
            <p className="mt-1 text-amber-200" role="alert">
              {unitsCheck.error}
            </p>
          ) : null}
        </label>
        <fieldset>
          <legend className="text-ink-muted">自评</legend>
          <div className="mt-2 flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`h-9 w-9 rounded-full ${
                  selfRating === n
                    ? "bg-accent text-white"
                    : "bg-white/5 text-ink-muted"
                }`}
                onClick={() => setSelfRating(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="text-ink-muted">学习方式</span>
          <select
            className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-ink-muted">备注（可选）</span>
          <textarea
            className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
            rows={2}
            value={selfNote}
            onChange={(e) => setSelfNote(e.target.value)}
          />
        </label>
        {showZeroHint ? (
          <p className="rounded-lg border border-white/10 bg-surface-3/50 px-3 py-2 text-ink-muted">
            未完成任何单位。若需改时间请使用「改期」。
          </p>
        ) : null}
        {canDefer ? (
          <div className="rounded-lg border border-white/10 bg-surface-3/50 p-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={deferRemaining}
                onChange={(e) => setDeferRemaining(e.target.checked)}
              />
              <span>剩余 {remaining} 课改到下次</span>
            </label>
            {deferRemaining ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <input
                  type="date"
                  className="rounded-lg border border-white/10 bg-surface px-2 py-1.5"
                  value={deferDate}
                  onChange={(e) => setDeferDate(e.target.value)}
                />
                <input
                  type="time"
                  className="rounded-lg border border-white/10 bg-surface px-2 py-1.5"
                  value={deferStart}
                  onChange={(e) => setDeferStart(e.target.value)}
                />
                <input
                  type="time"
                  className="rounded-lg border border-white/10 bg-surface px-2 py-1.5"
                  value={deferEnd}
                  onChange={(e) => setDeferEnd(e.target.value)}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        {overageHint ? (
          <p
            role="status"
            className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-emerald-200"
          >
            {overageHint}
          </p>
        ) : null}
        {submitError ? (
          <p className="text-sm text-amber-200" role="alert">
            {submitError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
