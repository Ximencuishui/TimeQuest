import { ProgressRings } from "questro/progress-rings";
import { ACCENT } from "../lib/constants";

type Props = {
  roundDone: number;
  roundTotal: number;
  roundsDone: number;
  roundsTotal: number;
  size?: number;
  unitName?: string;
};

export function TaskProgressRing({
  roundDone,
  roundTotal,
  roundsDone,
  roundsTotal,
  size = 120,
  unitName = "课",
}: Props) {
  const safeRound = Math.max(1, roundTotal || 1);
  const safeRounds = Math.max(1, roundsTotal || 1);
  return (
    <ProgressRings
      rings={[
        {
          label: "本轮",
          value: Math.min(roundDone, safeRound),
          max: safeRound,
          color: ACCENT,
        },
        {
          label: "轮次",
          value: Math.min(roundsDone, safeRounds),
          max: safeRounds,
          color: "#14B8A6",
        },
      ]}
      size={size}
      centerText={`${roundDone}/${roundTotal || "?"}`}
      centerLabel={unitName}
    />
  );
}
