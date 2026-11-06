type TooltipPayloadItem = {
  name?: string | number;
  value?: string | number | Array<string | number>;
  color?: string;
};

type Props = {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
};

/** Shared dark tooltip for Stats charts. */
export function ChartTooltip({ active, payload, label }: Props) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white shadow-lg shadow-black/40">
      {label != null && label !== "" ? (
        <div className="mb-1.5 text-xs text-zinc-400">{String(label)}</div>
      ) : null}
      <ul className="space-y-1">
        {payload.map((entry, i) => {
          const raw = entry.value;
          const num = typeof raw === "number" ? raw : null;
          return (
            <li
              key={`${String(entry.name)}-${i}`}
              className="flex items-center gap-2"
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: String(entry.color ?? "#f97316") }}
              />
              <span className="text-zinc-300">{entry.name}</span>
              <span className="ml-auto tabular-nums text-white">
                {num != null ? `${num} 分` : String(raw ?? "")}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
