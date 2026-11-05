import { NavLink, Outlet } from "react-router-dom";
import { APP_NAME, APP_SUBTITLE } from "../lib/constants";
import { AchievementHost } from "./AchievementHost";

const NAV = [
  { to: "/", label: "看板", end: true },
  { to: "/tasks", label: "任务" },
  { to: "/today", label: "今日" },
  { to: "/stats", label: "统计" },
  { to: "/notes", label: "便签" },
  { to: "/settings", label: "设置" },
];

export function Layout() {
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="hidden w-52 shrink-0 flex-col border-r border-white/5 bg-surface-2/80 px-3 py-5 md:flex">
        <div className="mb-8 px-2">
          <div className="font-display text-xl tracking-tight text-ink">
            {APP_NAME}
          </div>
          <div className="mt-1 text-xs leading-snug text-ink-muted">
            {APP_SUBTITLE}
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? "bg-accent/15 text-accent-soft"
                    : "text-ink-muted hover:bg-white/5 hover:text-ink"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
        <nav className="flex border-t border-white/5 bg-surface-2/95 md:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex-1 py-3 text-center text-xs ${
                  isActive ? "text-accent-soft" : "text-ink-muted"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <AchievementHost />
    </div>
  );
}
