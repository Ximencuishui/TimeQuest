import { useAppSetting } from "../hooks/useAppSetting";
import { todayStr } from "../lib/date";
import { resolveMotivation } from "../lib/motivation";

export function DailyMotivation() {
  const { data } = useAppSetting("motivation_text");
  const text = resolveMotivation(data, todayStr());

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
