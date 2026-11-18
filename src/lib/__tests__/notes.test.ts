import { describe, expect, it } from "vitest";
import { notesOnDate } from "../notes";
import type { Note } from "../../types";

function note(id: number, noteDate: string | null, content = `便签-${id}`): Note {
  return {
    id,
    content,
    color: "yellow",
    pinned: 0,
    note_date: noteDate,
    created_at: "2026-11-18 08:00:00",
    updated_at: "2026-11-18 08:00:00",
  };
}

describe("notesOnDate", () => {
  it("keeps_only_notes_bound_to_that_day", () => {
    const notes = [
      note(1, "2026-11-18"),
      note(2, "2026-11-19"),
      note(3, "2026-11-18"),
    ];

    expect(notesOnDate(notes, "2026-11-18").map((n) => n.id)).toEqual([1, 3]);
    expect(notesOnDate(notes, "2026-11-19").map((n) => n.id)).toEqual([2]);
  });

  it("ignores_notes_without_a_bound_date", () => {
    const notes = [note(1, null), note(2, undefined as unknown as string)];

    expect(notesOnDate(notes, "2026-11-18")).toEqual([]);
  });

  it("returns_empty_for_empty_date_or_empty_list", () => {
    expect(notesOnDate([note(1, "2026-11-18")], "")).toEqual([]);
    expect(notesOnDate([], "2026-11-18")).toEqual([]);
  });
});
