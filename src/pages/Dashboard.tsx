import { Link } from "react-router-dom";
import { CountdownPanel } from "../components/CountdownPanel";
import { StatusBar } from "../components/StatusBar";
import { SessionCard } from "../components/SessionCard";
import { useSessionsByDate } from "../hooks/useSessions";
import { todayStr } from "../lib/date";
import { APP_NAME } from "../lib/constants";

export function Dashboard() {
  const today = todayStr();
  const { data: sessions = [], isLoading } = useSessionsByDate(today);
  const planned = sessions.filter((s) => s.status === "planned");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header>
        <h1 className="font-display text-2xl text-ink">{APP_NAME}</h1>
        <p className="mt-1 text-sm text-ink-muted">今天也向前推进一步。</p>
      </header>
      <CountdownPanel />
      <StatusBar />
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg">今日排期</h2>
          <Link to="/today" className="text-sm text-accent-soft hover:underline">
            查看全部
          </Link>
        </div>
        {isLoading ? (
          <p className="text-sm text-ink-muted">加载中…</p>
        ) : planned.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-ink-muted">
            今日暂无待完成排期。
            <Link to="/today" className="ml-1 text-accent-soft hover:underline">
              去安排
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {planned.slice(0, 4).map((s) => (
              <SessionCard key={s.id} session={s} compact />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
