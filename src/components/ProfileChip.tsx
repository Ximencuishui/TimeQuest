import { profileLine } from "../lib/profile";
import type { UserProfile } from "../types";

export function ProfileChip({ profile }: { profile: UserProfile }) {
  const line = profileLine(profile.grade, profile.region);
  const initial = profile.grade.trim().slice(0, 1) || "档";
  return (
    <div className="flex min-w-0 items-center gap-2 px-2" data-testid="profile-chip">
      {profile.avatar ? (
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
      {line ? (
        <span className="truncate text-xs text-ink">{line}</span>
      ) : null}
    </div>
  );
}
