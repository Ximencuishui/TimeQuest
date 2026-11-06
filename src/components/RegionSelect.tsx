import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PROVINCES, canonicalProvince } from "../lib/profile";

const fieldClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm text-ink outline-none hover:border-white/20 focus:border-orange-500 focus:ring-1 focus:ring-orange-500";

export function RegionSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = canonicalProvince(value) ?? value;
  const [query, setQuery] = useState(shown);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setQuery(canonicalProvince(value) ?? value);
  }, [value]);

  const options = useMemo(() => {
    const q = query.trim();
    const current = canonicalProvince(value) ?? value.trim();
    if (!q || q === current) return [...PROVINCES];
    return PROVINCES.filter((name) => name.includes(q));
  }, [query, value]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      const input = rootRef.current?.querySelector("input");
      const label = input instanceof HTMLInputElement ? input.labels?.[0] : null;
      if (rootRef.current?.contains(target) || label?.contains(target)) return;
      setOpen(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  const commit = (name: string) => {
    setQuery(name);
    setOpen(false);
    onChange(name);
  };

  const narrowed = (() => {
    const q = query.trim();
    const current = (canonicalProvince(value) ?? value).trim();
    return q !== "" && q !== current;
  })();

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        className={fieldClass}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="选择省份"
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          const exact = canonicalProvince(next);
          setQuery(exact && exact !== next.trim() ? exact : next);
          setOpen(true);
          onChange(exact ?? next);
        }}
        onMouseDown={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (!open || options.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => (index + 1) % options.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => (index - 1 + options.length) % options.length);
          } else if (event.key === "Enter" && narrowed) {
            event.preventDefault();
            const name = options[active];
            if (name) commit(name);
          }
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-white/10 bg-surface-2 py-1 shadow-xl"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-ink-muted">没有匹配的省份</li>
          ) : (
            options.map((name, index) => (
              <li key={name} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={`block w-full px-3 py-1.5 text-left text-sm ${
                    index === active ? "bg-accent/20 text-ink" : "text-ink-muted hover:bg-white/5"
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(name);
                  }}
                >
                  {name}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
