import type { Note } from "../types";

/**
 * 当天绑定的便签。
 *
 * 只有显式绑定到该日期的便签才算「这天要做的事」；
 * 没绑日期的便签仍然只出现在便签墙上，不会被塞进某一天。
 */
export function notesOnDate(notes: Note[], date: string): Note[] {
  if (!date) return [];
  return notes.filter((note) => note.note_date === date);
}
