import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../api/tauri";
import { textbookSuggestions, type AvailableTextbook } from "../lib/textbooks";

const fieldClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-ink outline-none hover:border-white/20 focus:border-orange-500 focus:ring-1 focus:ring-orange-500";

export function TextbookCombobox({
  subject,
  value,
  onChange,
  onPick,
}: {
  subject: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (book: AvailableTextbook, totalUnits: number | null) => void;
}) {
  const listId = useId();
  const inputId = useId();
  const [books, setBooks] = useState<AvailableTextbook[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const suggestions = useMemo(
    () => textbookSuggestions(
      books.filter((book) => book.subject === subject),
      value,
    ),
    [books, subject, value],
  );

  useEffect(() => {
    let alive = true;
    api
      .listAvailableTextbooks()
      .then((items) => {
        if (alive) setBooks(Array.isArray(items) ? items : []);
      })
      .catch(() => {
        if (alive) setBooks([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setActive(0);
  }, [value, open]);

  const pick = (book: AvailableTextbook) => {
    setOpen(false);
    onChange(book.volume);
    void api
      .getTextbookOutline(book.subject, book.version, book.volume)
      .then((outline) => {
        const total = outline.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0);
        onPick(book, total > 0 ? total : null);
      })
      .catch(() => onPick(book, null));
  };

  return (
    <div ref={rootRef} className="relative block">
      <label htmlFor={inputId} className="block text-ink-muted">
        课本
      </label>
      <input
        id={inputId}
        className={fieldClass}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="输入或选择课本，如 必修第一册"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
            return;
          }
          if (!open || suggestions.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => (index + 1) % suggestions.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => (index - 1 + suggestions.length) % suggestions.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            const book = suggestions[active];
            if (book) pick(book);
          }
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-white/10 bg-surface-2 py-1 shadow-xl"
        >
          {suggestions.length === 0 ? (
            <li className="px-3 py-2 text-xs text-ink-muted">没有匹配的课本，可直接使用输入的名称</li>
          ) : (
            suggestions.map((book, index) => {
              const label = `${book.subject} ${book.version} ${book.volume}`;
              return (
                <li key={label} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    className={`flex w-full flex-col px-3 py-1.5 text-left hover:bg-white/5 ${
                      index === active ? "bg-white/5" : ""
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(book)}
                  >
                    <span className="text-sm text-ink">{book.volume}</span>
                    <span className="text-xs text-ink-muted">
                      {book.subject} · {book.version}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
