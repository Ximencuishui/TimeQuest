export const CHART_EMPTY_COPY =
  "这段时间还没有学习记录，去开启一个番茄钟吧。";

type Props = {
  /** Override default copy; ratings etc. may keep a shorter line. */
  message?: string;
};

/** Minimal empty illustration + copy — no axes, no blank Recharts shell. */
export function ChartEmptyState({ message = CHART_EMPTY_COPY }: Props) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center"
      data-testid="chart-empty-state"
    >
      <svg
        width="72"
        height="64"
        viewBox="0 0 72 64"
        fill="none"
        aria-hidden
        className="opacity-80"
      >
        {/* stack of books */}
        <rect
          x="8"
          y="36"
          width="40"
          height="10"
          rx="2"
          fill="#3f3f46"
          stroke="#52525b"
        />
        <rect
          x="12"
          y="26"
          width="36"
          height="10"
          rx="2"
          fill="#27272a"
          stroke="#3f3f46"
        />
        <rect
          x="16"
          y="16"
          width="32"
          height="10"
          rx="2"
          fill="#1c1917"
          stroke="#f97316"
          strokeOpacity="0.45"
        />
        {/* hourglass */}
        <path
          d="M52 12h12v4l-5 8 5 8v4H52v-4l5-8-5-8v-4z"
          fill="#27272a"
          stroke="#f97316"
          strokeOpacity="0.7"
          strokeWidth="1.2"
        />
        <circle cx="58" cy="28" r="1.5" fill="#f97316" />
      </svg>
      <p className="max-w-xs text-sm text-zinc-500">{message}</p>
    </div>
  );
}
