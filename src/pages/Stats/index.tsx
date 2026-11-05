import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Modal } from "../../components/Modal";
import { useCreateLog } from "../../hooks/useLogs";
import {
  useAvgRatings,
  useCompletionRate,
  useMethodShare,
  usePlanVsActual,
  useTagTypeTotals,
} from "../../hooks/useStats";
import { METHODS, SUBJECTS, TAG_TYPES } from "../../lib/constants";
import { todayStr } from "../../lib/date";

type RangeMode = "week" | "month";

function rangeFor(mode: RangeMode) {
  const now = new Date();
  if (mode === "week") {
    return {
      from: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      to: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }
  return {
    from: format(startOfMonth(now), "yyyy-MM-dd"),
    to: format(endOfMonth(now), "yyyy-MM-dd"),
  };
}

const PIE_COLORS = ["#F97316", "#14B8A6", "#3B82F6", "#EAB308", "#EC4899"];

export function Stats() {
  const [mode, setMode] = useState<RangeMode>("week");
  const range = useMemo(() => rangeFor(mode), [mode]);
  const { data: pva = [] } = usePlanVsActual(range.from, range.to);
  const { data: methods = [] } = useMethodShare(range.from, range.to);
  const { data: tags = [] } = useTagTypeTotals(range.from, range.to);
  const { data: rate } = useCompletionRate(range.from, range.to);
  const { data: ratings = [] } = useAvgRatings(range.from, range.to);
  const createLog = useCreateLog();
  const [logOpen, setLogOpen] = useState(false);
  const [logForm, setLogForm] = useState({
    date: todayStr(),
    startAt: "09:00",
    endAt: "10:00",
    subject: "数学",
    method: "刷题",
    tagType: "study",
    note: "",
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">统计</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-surface-2 p-1">
            {(["week", "month"] as RangeMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`rounded-md px-3 py-1.5 text-sm ${
                  mode === m ? "bg-accent text-white" : "text-ink-muted"
                }`}
                onClick={() => setMode(m)}
              >
                {m === "week" ? "本周" : "本月"}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5"
            onClick={() => setLogOpen(true)}
          >
            快速记录
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-muted">
        {range.from} ~ {range.to}
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="计划达成率"
          value={
            rate
              ? `${Math.round((rate.rate || 0) * 100)}%`
              : "—"
          }
          hint={
            rate
              ? `完成 ${rate.done} / 分母 ${rate.done + rate.missed + rate.rescheduled}`
              : ""
          }
        />
        <StatTile
          label="学习实际分钟"
          value={String(
            tags.find((t) => t.tag_type === "study")?.duration_min ?? 0,
          )}
        />
        <StatTile
          label="运动 / 游戏"
          value={`${tags.find((t) => t.tag_type === "sport")?.duration_min ?? 0} / ${
            tags.find((t) => t.tag_type === "game")?.duration_min ?? 0
          }`}
        />
      </div>

      <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
        <h2 className="mb-3 font-display text-lg">计划 vs 实际（分钟）</h2>
        {pva.length === 0 ? (
          <p className="text-sm text-ink-muted">暂无计划/实际数据</p>
        ) : (
          <div className="h-64" data-testid="plan-vs-actual-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pva}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis dataKey="subject" stroke="#8b9aab" fontSize={12} />
                <YAxis stroke="#8b9aab" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: "#1a222c",
                    border: "1px solid #ffffff20",
                  }}
                />
                <Legend />
                <Bar dataKey="planned_min" name="计划" fill="#64748b" />
                <Bar dataKey="actual_min" name="实际" fill="#F97316" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
          <h2 className="mb-3 font-display text-lg">学习方式占比</h2>
          {methods.length === 0 ? (
            <p className="text-sm text-ink-muted">暂无方式数据</p>
          ) : (
            <>
              <div className="h-56" data-testid="method-share-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={methods}
                      dataKey="duration_min"
                      nameKey="method"
                      outerRadius={80}
                      label
                    >
                      {methods.map((_, i) => (
                        <Cell
                          key={i}
                          fill={PIE_COLORS[i % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "#1a222c",
                        border: "1px solid #ffffff20",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul
                className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted"
                aria-label="学习方式占比明细"
              >
                {methods.map((m) => (
                  <li key={m.method}>
                    {m.method} · {m.duration_min} 分
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="rounded-2xl border border-white/5 bg-surface-2/80 p-4">
          <h2 className="mb-3 font-display text-lg">平均自评</h2>
          {ratings.length === 0 ? (
            <p className="text-sm text-ink-muted">暂无自评数据</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {ratings.map((r) => (
                <li
                  key={r.key}
                  className="flex justify-between border-b border-white/5 py-2"
                >
                  <span>{r.key}</span>
                  <span className="text-accent-soft">
                    {r.avg_rating.toFixed(1)} ★ · {r.count} 次
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Modal
        open={logOpen}
        title="快速记录"
        onClose={() => setLogOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-ink-muted"
              onClick={() => setLogOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-accent px-4 py-2 text-white"
              disabled={createLog.isPending}
              onClick={async () => {
                await createLog.mutateAsync({
                  date: logForm.date,
                  startAt: `${logForm.date}T${logForm.startAt}:00`,
                  endAt: `${logForm.date}T${logForm.endAt}:00`,
                  subject: logForm.subject,
                  method: logForm.method,
                  tagType: logForm.tagType,
                  note: logForm.note || null,
                });
                setLogOpen(false);
              }}
            >
              保存
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-ink-muted">类型</span>
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
              value={logForm.tagType}
              onChange={(e) =>
                setLogForm({ ...logForm, tagType: e.target.value })
              }
            >
              {TAG_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-muted">科目</span>
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
              value={logForm.subject}
              onChange={(e) =>
                setLogForm({ ...logForm, subject: e.target.value })
              }
            >
              {SUBJECTS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-muted">方式</span>
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
              value={logForm.method}
              onChange={(e) =>
                setLogForm({ ...logForm, method: e.target.value })
              }
            >
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-muted">日期</span>
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
              value={logForm.date}
              onChange={(e) => setLogForm({ ...logForm, date: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="time"
              className="rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
              value={logForm.startAt}
              onChange={(e) =>
                setLogForm({ ...logForm, startAt: e.target.value })
              }
            />
            <input
              type="time"
              className="rounded-lg border border-white/10 bg-surface-3 px-3 py-2"
              value={logForm.endAt}
              onChange={(e) => setLogForm({ ...logForm, endAt: e.target.value })}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-surface-2/80 p-4">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="mt-1 font-display text-2xl text-accent-soft">{value}</div>
      {hint ? <div className="mt-1 text-xs text-ink-muted">{hint}</div> : null}
    </div>
  );
}
