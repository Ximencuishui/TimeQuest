import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NoteCard, { type NoteCardProps } from "../NoteCard";
import { Notes } from "../../pages/Notes";
import { Today } from "../../pages/Today";
import type { Note } from "../../types";

/**
 * 便签绑定日期：
 * - 卡片上可以直接选日期（绑定 / 解绑）
 * - 新建便签时可以顺手绑一个日期
 * - 绑定后的便签会出现在「今天要做的事」里
 */

const mockedInvoke = vi.mocked(invoke);

function note(partial: Partial<Note> & Pick<Note, "id">): Note {
  return {
    content: `便签-${partial.id}`,
    color: "yellow",
    pinned: 0,
    note_date: null,
    created_at: "2026-11-18 08:00:00",
    updated_at: "2026-11-18 08:00:00",
    ...partial,
  };
}

function renderCard(props: Partial<NoteCardProps> = {}) {
  const onSetDate = vi.fn();
  const view = render(
    <NoteCard
      note={note({ id: 3 })}
      editing={false}
      editText=""
      onEditText={vi.fn()}
      onStartEdit={vi.fn()}
      onCancelEdit={vi.fn()}
      onSave={vi.fn()}
      onTogglePin={vi.fn()}
      onDelete={vi.fn()}
      onSetDate={onSetDate}
      {...props}
    />,
  );
  return { onSetDate, ...view };
}

function renderNotes() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Notes />
    </QueryClientProvider>,
  );
}

function renderToday() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Today />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("便签绑定日期", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 18, 9, 0, 0));
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_notes") return [];
      if (cmd === "list_tasks") return [];
      if (cmd === "list_sessions_by_date") return [];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("note_card_binds_a_date_from_the_picker", () => {
    const { onSetDate } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: "便签日期：未绑定日期" }));
    fireEvent.click(screen.getByRole("button", { name: "明天" }));

    expect(onSetDate).toHaveBeenCalledWith(3, "2026-11-19");
  });

  it("note_card_shows_the_bound_date_and_can_unbind", () => {
    const { onSetDate } = renderCard({
      note: note({ id: 5, note_date: "2026-11-18" }),
    });

    const trigger = screen.getByRole("button", { name: "便签日期：今天 · 11月18日" });
    expect(trigger).toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "未绑定日期" }));

    expect(onSetDate).toHaveBeenCalledWith(5, "");
  });

  it("notes_page_creates_a_note_with_the_chosen_date", async () => {
    renderNotes();

    fireEvent.change(screen.getByPlaceholderText("写下一张提醒…"), {
      target: { value: "背有机化学" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新便签日期：不绑定日期" }));
    fireEvent.click(screen.getByRole("button", { name: "明天" }));
    fireEvent.click(screen.getByRole("button", { name: "添加便签" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter((c) => c[0] === "create_note");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({
        content: "背有机化学",
        color: "yellow",
        noteDate: "2026-11-19",
      });
    });
  });

  it("today_page_shows_only_notes_bound_to_that_day", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_notes") {
        return [
          note({ id: 1, note_date: "2026-11-18", content: "今天要背的" }),
          note({ id: 2, note_date: "2026-11-19", content: "明天的" }),
          note({ id: 3, note_date: null, content: "没绑日期的" }),
        ];
      }
      if (cmd === "list_tasks") return [];
      if (cmd === "list_sessions_by_date") return [];
      return null;
    });

    renderToday();

    await waitFor(() => {
      expect(screen.getByTestId("day-notes")).toBeInTheDocument();
    });
    expect(screen.getByText("今天要背的")).toBeInTheDocument();
    expect(screen.queryByText("明天的")).not.toBeInTheDocument();
    expect(screen.queryByText("没绑日期的")).not.toBeInTheDocument();
  });
});
