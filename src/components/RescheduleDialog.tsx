import { useEffect, useState } from "react";
import { DateField } from "./DateField";
import { Modal } from "./Modal";
import { TimeRangeField } from "./TimeRangeField";
import type { TaskSession } from "../types";
import { todayStr } from "../lib/date";
import { timeRangeError } from "../lib/sessionTime";

type Props = {
  session: TaskSession | null;
  onClose: () => void;
  onSubmit: (data: { date: string; startTime: string; endTime: string }) => void;
  busy?: boolean;
};

export function RescheduleDialog({ session, onClose, onSubmit, busy }: Props) {
  const [date, setDate] = useState(todayStr());
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("20:00");

  useEffect(() => {
    if (session) {
      setDate(session.date);
      setStartTime(session.start_time);
      setEndTime(session.end_time);
    }
  }, [session]);

  if (!session) return null;

  // 防呆：改期同样不允许结束早于开始。
  const rangeError = timeRangeError(startTime, endTime);

  return (
    <Modal
      open
      title="重新安排"
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
            disabled={busy || rangeError != null}
            className="rounded-lg border border-white/20 bg-surface-3 px-4 py-2 text-ink hover:bg-white/10 disabled:opacity-50"
            onClick={() => onSubmit({ date, startTime, endTime })}
          >
            确认改期
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-muted">
        重新安排也是计划的一部分。原排期会保留为「已改期」，不影响历史追溯。
      </p>
      <div className="space-y-3 text-sm">
        <div className="block">
          <span className="text-ink-muted">新日期</span>
          <div className="mt-1">
            <DateField label="新日期" value={date} onChange={setDate} />
          </div>
        </div>
        <TimeRangeField
          start={startTime}
          end={endTime}
          onChange={(nextStart, nextEnd) => {
            setStartTime(nextStart);
            setEndTime(nextEnd);
          }}
        />
        {rangeError ? (
          <p className="text-sm text-amber-200" role="alert">
            {rangeError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
