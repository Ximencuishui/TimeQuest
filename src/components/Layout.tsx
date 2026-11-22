import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { APP_NAME, APP_SUBTITLE } from "../lib/constants";
import { useUserProfile } from "../hooks/useUserProfile";
import { AchievementHost } from "./AchievementHost";
import { CelebrationHost } from "./CelebrationHost";
import { FocusHost } from "./FocusHost";
import { ProfileChip } from "./ProfileChip";

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
};

type NavGroup = {
  key: string;
  title: string;
  emoji: string;
  items: NavItem[];
};

/**
 * 侧边栏按「计划 → 复盘 → 工具」分组。
 *
 * 分组顺序就是产品的核心流程心智：先看总计划，再看今天做什么，
 * 然后复盘，最后才是工具。分组标题弱化，子项保持高亮选中态。
 *
 * 设置不占导航位：点头像（`ProfileChip`）直接进 `/settings`。
 */
const NAV_GROUPS: NavGroup[] = [
  {
    key: "plan",
    title: "计划",
    emoji: "📌",
    items: [
      { to: "/tasks", label: "总计划", icon: <PlanIcon /> },
      { to: "/today", label: "今日任务", icon: <TodayIcon /> },
    ],
  },
  {
    key: "review",
    title: "复盘",
    emoji: "📊",
    items: [
      { to: "/stats", label: "统计", icon: <StatsIcon /> },
      { to: "/scores", label: "成绩", icon: <ScoreIcon /> },
    ],
  },
  {
    key: "tools",
    title: "工具",
    emoji: "🧩",
    items: [
      { to: "/", label: "看板", icon: <BoardIcon />, end: true },
      { to: "/notes", label: "便签", icon: <NoteIcon /> },
      { to: "/toolbox", label: "工具箱", icon: <ToolboxIcon /> },
    ],
  },
];

/** 窄屏底部导航：跟侧边栏同一套顺序，只是压平。设置走头像，不占底栏。 */
const MOBILE_NAV = [
  { to: "/tasks", label: "总计划" },
  { to: "/today", label: "今日" },
  { to: "/stats", label: "统计" },
  { to: "/scores", label: "成绩" },
  { to: "/", label: "看板", end: true },
  { to: "/notes", label: "便签" },
  { to: "/toolbox", label: "工具箱" },
];

const linkClass = (isActive: boolean) =>
  `relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
    isActive
      ? "bg-accent/15 text-accent-soft"
      : "text-ink-muted hover:bg-white/5 hover:text-ink"
  }`;

export function Layout() {
  const { data: profile } = useUserProfile();

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="hidden w-52 shrink-0 flex-col border-r border-white/5 bg-surface-2/80 px-3 py-5 md:flex">
        <div className="mb-6 px-2">
          <div className="font-display text-xl tracking-tight text-ink">
            {APP_NAME}
          </div>
          <div className="mt-1 text-xs leading-snug text-ink-muted">
            {APP_SUBTITLE}
          </div>
        </div>
        <nav className="flex flex-1 flex-col overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.key} className="mb-1 first:mb-0">
              <div
                data-testid={`nav-group-${group.key}`}
                className="mb-1 flex items-center gap-1.5 px-3 pt-3 text-[11px] font-medium tracking-wide text-ink-muted/70"
              >
                <span aria-hidden className="leading-none opacity-80">
                  {group.emoji}
                </span>
                <span>{group.title}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => linkClass(isActive)}
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          aria-hidden
                          className={`absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full transition ${
                            isActive ? "bg-accent" : "bg-transparent"
                          }`}
                        />
                        <span className="shrink-0 opacity-90">{item.icon}</span>
                        <span className="truncate">{item.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-auto border-t border-white/5 pt-4">
          <ProfileChip profile={profile} />
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="border-b border-white/5 px-4 py-2 md:hidden">
          <ProfileChip profile={profile} />
        </div>
        <main className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
        <nav className="flex border-t border-white/5 bg-surface-2/95 md:hidden">
          {MOBILE_NAV.map((item) => (
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
      <CelebrationHost />
      <FocusHost />
    </div>
  );
}

/** 导航图标统一用线性描边，和应用里的其它图标一个画法。 */
const ICON_PROPS = {
  viewBox: "0 0 24 24",
  "aria-hidden": true,
  className: "h-4 w-4",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function PlanIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 6.5h10M4 12h7M4 17.5h10" />
      <path d="M17 4.5v15M14.5 7 17 4.5 19.5 7" />
    </svg>
  );
}

function TodayIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3M8.5 13.5l2 2 4-4" />
    </svg>
  );
}

function StatsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 19.5h16" />
      <path d="M7 19.5v-6M12 19.5v-11M17 19.5v-8" />
    </svg>
  );
}

function ScoreIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6 4.5h9.5L19 8v11.5H6z" />
      <path d="M9.5 12.5h6M9.5 16h4" />
      <path d="M15 4.5V8h3.5" />
    </svg>
  );
}

function BoardIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4.5 4.5h15v11l-4 4h-11z" />
      <path d="M19.5 15.5h-4v4M8 9h8M8 12.5h5" />
    </svg>
  );
}

function ToolboxIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3.5" y="8" width="17" height="11.5" rx="2" />
      <path d="M9 8V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2M3.5 13h17" />
    </svg>
  );
}
