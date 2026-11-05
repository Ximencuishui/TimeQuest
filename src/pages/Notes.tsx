import { useCallback, useState } from "react";
import NoteCard from "../components/NoteCard";
import { NOTE_COLOR_CLASSES } from "../lib/colors";
import { NOTE_COLORS, type NoteColor } from "../lib/constants";
import { useNoteMutations, useNotes } from "../hooks/useNotes";

export function Notes() {
  const { data: notes = [], isLoading } = useNotes();
  const { create, update, remove } = useNoteMutations();
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<NoteColor>("yellow");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const updateNote = update.mutateAsync;
  const togglePin = update.mutate;
  const deleteNote = remove.mutate;

  const onEditText = useCallback((value: string) => {
    setEditText(value);
  }, []);

  const onStartEdit = useCallback((id: number, content: string) => {
    setEditingId(id);
    setEditText(content);
  }, []);

  const onCancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const onSave = useCallback(
    async (id: number, content: string) => {
      await updateNote({ id, payload: { content } });
      setEditingId(null);
    },
    [updateNote],
  );

  const onTogglePin = useCallback(
    (id: number, pinned: boolean) => {
      togglePin({ id, payload: { pinned } });
    },
    [togglePin],
  );

  const onDelete = useCallback(
    (id: number) => {
      if (window.confirm("确认删除这张便签？")) {
        deleteNote(id);
      }
    },
    [deleteNote],
  );

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-5 font-display text-2xl">便签墙</h1>

      <div className="mb-6 rounded-2xl border border-white/5 bg-surface-2/80 p-4">
        <textarea
          className="w-full rounded-lg border border-white/10 bg-surface-3 px-3 py-2 text-sm"
          rows={3}
          placeholder="写下一张提醒…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`h-7 w-7 rounded-full border-2 ${
                  NOTE_COLOR_CLASSES[c].bg
                } ${color === c ? "border-white" : "border-transparent"}`}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
          <button
            type="button"
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={!draft.trim() || create.isPending}
            onClick={async () => {
              await create.mutateAsync({ content: draft.trim(), color });
              setDraft("");
            }}
          >
            添加便签
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-ink-muted">加载中…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-ink-muted">还没有便签。</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              editing={editingId === n.id}
              editText={editingId === n.id ? editText : ""}
              onEditText={onEditText}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onSave={onSave}
              onTogglePin={onTogglePin}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
