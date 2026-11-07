import { create } from "zustand";

export const CELEBRATIONS_SETTING_KEY = "enable_celebrations";

export type CelebrationType = "task_complete" | "streak_milestone";

export type CelebrationDetail = {
  taskTitle?: string | null;
  streakDays?: number | null;
};

export type CelebrationRequest = {
  type: CelebrationType;
  taskTitle?: string;
  streakDays?: number;
};

const ORANGE = ["#F97316", "#FDBA74", "#FFF7ED", "#FB923C"];

/** 未写入、空串都算开启。只有明确的 `0` / `false` 才关掉。 */
export function isCelebrationsEnabled(
  value: string | null | undefined,
): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  if (trimmed === "") return true;
  return trimmed !== "0" && trimmed.toLowerCase() !== "false";
}

/**
 * 同一场只返回一种庆祝。通关优先于连击，避免叠两层浮层和两声音效。
 * 连击只认后端给出的 `streakMilestone`（刚跨到 7 / 14 / 30），不看停留中的 currentStreak。
 */
export function resolveCelebration(result: {
  isTaskFullyCompleted?: boolean;
  streakMilestone?: number | null;
  session?: { task_title?: string | null };
}): CelebrationRequest | null {
  if (result.isTaskFullyCompleted) {
    const title = result.session?.task_title?.trim();
    return title
      ? { type: "task_complete", taskTitle: title }
      : { type: "task_complete" };
  }
  const days = result.streakMilestone;
  if (days === 7 || days === 14 || days === 30) {
    return { type: "streak_milestone", streakDays: days };
  }
  return null;
}

export function celebrationMessage(
  type: CelebrationType,
  detail?: CelebrationDetail,
): string {
  if (type === "task_complete") {
    const title = detail?.taskTitle?.trim();
    if (title) return `🎉 恭喜通关《${title}》！你的城堡又高了一层！`;
    return "🎉 恭喜通关！你的城堡又高了一层！";
  }
  if (detail?.streakDays === 14) {
    return "🔥 连击 14 天达成！两周不断档，这座城堡又稳了一层。";
  }
  if (detail?.streakDays === 30) {
    return "🔥 连击 30 天达成！一个月的砖，已经垒成一座城堡。";
  }
  const days = detail?.streakDays ?? 7;
  if (days === 7) {
    return "🔥 连击 7 天达成！你已经击败了全国 90% 的考生！";
  }
  return `🔥 连击 ${days} 天达成！`;
}

type CelebrationState = {
  message: string | null;
  token: number;
  show: (message: string) => void;
  clear: () => void;
};

export const useCelebrationStore = create<CelebrationState>((set) => ({
  message: null,
  token: 0,
  show: (message) => set((state) => ({ message, token: state.token + 1 })),
  clear: () => set({ message: null }),
}));

function audioContextCtor(): (new () => AudioContext) | undefined {
  const host = globalThis as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return host.AudioContext ?? host.webkitAudioContext;
}

/** 用 Web Audio 合成一段短和弦。没有音频设备时静默跳过。 */
export function playCelebrationChord(type: CelebrationType): void {
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    const notes =
      type === "task_complete"
        ? [523.25, 659.25, 783.99, 1046.5]
        : [392, 523.25, 659.25];
    const now = ctx.currentTime;
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const start = now + index * 0.09;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.07, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
    window.setTimeout(() => {
      void ctx.close();
    }, 1200);
  } catch {
    /* 没有音频设备时不打断完成 */
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** 通关是大满贯：左右和正中各放一次。连击只放一轮。 */
export async function fireConfetti(type: CelebrationType): Promise<void> {
  if (prefersReducedMotion()) return;
  try {
    const mod = await import("canvas-confetti");
    const confetti = mod.default;
    const base = {
      colors: ORANGE,
      disableForReducedMotion: true,
      ticks: 120,
      gravity: 1.05,
      scalar: 0.9,
    };
    if (type === "task_complete") {
      const bursts = [
        { angle: 60, origin: { x: 0.05, y: 0.7 } },
        { angle: 120, origin: { x: 0.95, y: 0.7 } },
        { angle: 90, origin: { x: 0.5, y: 0.85 } },
      ];
      bursts.forEach((burst, index) => {
        window.setTimeout(() => {
          void confetti({
            ...base,
            particleCount: 70,
            spread: 55,
            startVelocity: 42,
            angle: burst.angle,
            origin: burst.origin,
          });
        }, index * 160);
      });
      return;
    }
    void confetti({
      ...base,
      particleCount: 80,
      spread: 70,
      startVelocity: 38,
      origin: { x: 0.5, y: 0.65 },
    });
  } catch {
    /* 烟花失败不影响完成 */
  }
}
