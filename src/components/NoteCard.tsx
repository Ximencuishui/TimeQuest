import { memo } from "react";
import { NOTE_COLOR_CLASSES } from "../lib/colors";
import { NOTE_COLORS, type NoteColor } from "../lib/constants";
import type { Note } from "../types";

export type NoteCardProps = {
  note: Note;
  editing: boolean;
  editText: string;
  onEditText: (value: string) => void;
  onStartEdit: (id: number, content: string) => void;
  onCancelEdit: () => void;
  onSave: (id: number, content: string) => void;
  onTogglePin: (id: number, pinned: boolean) => void;
  onDelete: (id: number) => void;
};

/** list_notes 每次给出新对象；置顶还会改排序，按位置的结构共享对不上同一张便签。 */
function sameNoteView(a: Note, b: Note): boolean {
  return (
    a.id === b.id &&
    a.content === b.content &&
    a.color === b.color &&
    a.pinned === b.pinned
  );
}

function areEqual(prev: NoteCardProps, next: NoteCardProps): boolean {
  return (
    sameNoteView(prev.note, next.note) &&
    prev.editing === next.editing &&
    prev.editText === next.editText &&
    prev.onEditText === next.onEditText &&
    prev.onStartEdit === next.onStartEdit &&
    prev.onCancelEdit === next.onCancelEdit &&
    prev.onSave === next.onSave &&
    prev.onTogglePin === next.onTogglePin &&
    prev.onDelete === next.onDelete
  );
}

function NoteCard({
  note,
  editing,
  editText,
  onEditText,
  onStartEdit,
  onCancelEdit,
  onSave,
  onTogglePin,
  onDelete,
}: NoteCardProps) {
  const c = (
    NOTE_COLORS.includes(note.color as NoteColor) ? note.color : "yellow"
  ) as NoteColor;
  const cls = NOTE_COLOR_CLASSES[c];

  return (
    <article
      className={`relative rounded-xl border p-4 shadow-md ${cls.bg} ${cls.border} ${cls.text}`}
    >
      {note.pinned ? (
        <span className="absolute right-2 top-2 text-xs font-medium">置顶</span>
      ) : null}
      {editing ? (
        <textarea
          className="mt-4 w-full rounded border border-black/10 bg-white/50 p-2 text-sm"
          rows={4}
          value={editText}
          onChange={(e) => onEditText(e.target.value)}
        />
      ) : (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">
          {note.content}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {editing ? (
          <>
            <button
              type="button"
              className="rounded bg-black/10 px-2 py-1"
              onClick={() => void onSave(note.id, editText)}
            >
              保存
            </button>
            <button
              type="button"
              className="rounded bg-black/10 px-2 py-1"
              onClick={onCancelEdit}
            >
              取消
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="rounded bg-black/10 px-2 py-1"
              onClick={() => onStartEdit(note.id, note.content)}
            >
              编辑
            </button>
            <button
              type="button"
              className="rounded bg-black/10 px-2 py-1"
              onClick={() => onTogglePin(note.id, !note.pinned)}
            >
              {note.pinned ? "取消置顶" : "置顶"}
            </button>
            <button
              type="button"
              className="rounded bg-black/10 px-2 py-1"
              onClick={() => onDelete(note.id)}
            >
              删除
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export default memo(NoteCard, areEqual);
