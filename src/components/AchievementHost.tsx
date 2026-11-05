import { AchievementToast } from "questro/achievement-toast";
import { useUiStore } from "../store/ui";

export function AchievementHost() {
  const toast = useUiStore((s) => s.achievementToast);
  const showAchievement = useUiStore((s) => s.showAchievement);

  if (!toast) return null;

  return (
    <AchievementToast
      achievement={{
        title: toast.title,
        description: toast.description,
        type: "badge",
        icon: "🏆",
        showConfetti: true,
      }}
      onClose={() => showAchievement(null)}
    />
  );
}
