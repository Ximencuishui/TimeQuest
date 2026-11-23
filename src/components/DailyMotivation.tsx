import { useAppSetting } from "../hooks/useAppSetting";
import { useMotivationLines } from "../hooks/useMotivationLines";
import { todayStr } from "../lib/date";
import { resolveMotivation } from "../lib/motivation";

export function DailyMotivation() {
  const { data } = useAppSetting("motivation_text");
  // 语料跟着赛道走：赛道包装了语料包就用它的。
  const lines = useMotivationLines();
  const text = resolveMotivation(data, todayStr(), lines);

  return (
    <blockquote className="m-0 max-w-[46%] shrink-0 text-right text-sm italic leading-relaxed text-zinc-400 sm:max-w-xs">
      <span
        aria-hidden="true"
        className="mr-1 inline-block -rotate-6 font-serif text-base not-italic text-zinc-500"
      >
        “
      </span>
      <span>{text}</span>
      <span
        aria-hidden="true"
        className="ml-1 inline-block rotate-6 font-serif text-base not-italic text-zinc-500"
      >
        ”
      </span>
    </blockquote>
  );
}
