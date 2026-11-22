import { NavLink } from "react-router-dom";
import { profileLine } from "../lib/profile";
import type { UserProfile } from "../types";

/**
 * 侧边栏底部的用户头像：设置页的唯一入口。
 *
 * 设置不再占用一个导航分组，点头像直接跳到 `/settings`。
 * 没有档案数据时也保留占位头像，保证设置页在任何时候都点得到。
 */
export function ProfileChip({ profile }: { profile?: UserProfile | null }) {
  const line = profile ? profileLine(profile.grade, profile.region) : "";
  const initial = profile?.grade.trim().slice(0, 1) || "档";
  return (
    <NavLink
      to="/settings"
      title="打开设置"
      aria-label={line ? `${line}，打开设置` : "打开设置"}
      data-testid="profile-chip"
      className={({ isActive }) =>
        `flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition ${
          isActive
            ? "bg-accent/15 text-accent-soft"
            : "text-ink hover:bg-white/5"
        }`
      }
    >
      {profile?.avatar ? (
        <img
          src={profile.avatar}
          alt="头像"
          className="h-8 w-8 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] text-zinc-400"
        >
          {initial}
        </span>
      )}
      {line ? <span className="truncate text-xs text-ink">{line}</span> : null}
    </NavLink>
  );
}
