import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTE_COLORS } from "../../../lib/constants";
import type { Note } from "../../../types";
import { Notes } from "../../Notes.tsx";

const articleCounter = vi.hoisted(() => ({ n: 0 }));

vi.mock("react/jsx-dev-runtime", async () => {
  const actual = await vi.importActual<typeof import("react/jsx-dev-runtime")>(
    "react/jsx-dev-runtime",
  );
  return {
    ...actual,
    jsxDEV(
      type: unknown,
      props: unknown,
      key: unknown,
      isStatic: unknown,
      source: unknown,
      self: unknown,
    ) {
      if (type === "article") articleCounter.n += 1;
      return actual.jsxDEV(
        type as never,
        props as never,
        key as never,
        isStatic as never,
        source as never,
        self as never,
      );
    },
  };
});

vi.mock("react/jsx-runtime", async () => {
  const actual = await vi.importActual<typeof import("react/jsx-runtime")>(
    "react/jsx-runtime",
  );
  return {
    ...actual,
    jsx(type: unknown, props: unknown, key: unknown) {
      if (type === "article") articleCounter.n += 1;
      return actual.jsx(type as never, props as never, key as never);
    },
    jsxs(type: unknown, props: unknown, key: unknown) {
      if (type === "article") articleCounter.n += 1;
      return actual.jsxs(type as never, props as never, key as never);
    },
  };
});

const mockedInvoke = vi.mocked(invoke);

function renderNotes() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Notes />
    </QueryClientProvider>,
  );
}

function makeNotes(count: number): Note[] {
  return Array.from({ length: count }, (_, i) => {
    const id = i + 1;
    return {
      id,
      content: `便签-${id}`,
      color: NOTE_COLORS[i % NOTE_COLORS.length]!,
      pinned: i % 5 === 0 ? 1 : 0,
      created_at: "2026-01-01 10:00:00",
      updated_at: "2026-01-01 10:00:00",
    };
  });
}

describe("Notes page", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("notes_page_renders_all_notes_without_virtualization", async () => {
    const notes = makeNotes(120);
    let resolveNotes: (rows: Note[]) => void = () => {};
    const pending = new Promise<Note[]>((resolve) => {
      resolveNotes = resolve;
    });
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_notes") return pending;
      return null;
    });

    const { container } = renderNotes();
    expect(screen.getByText("加载中…")).toBeInTheDocument();
    expect(container.querySelectorAll("article")).toHaveLength(0);

    const counts: number[] = [];
    const observer = new MutationObserver(() => {
      counts.push(container.querySelectorAll("article").length);
    });
    observer.observe(container, { childList: true, subtree: true });

    await act(async () => {
      resolveNotes(notes);
      await pending;
    });

    await waitFor(() => {
      expect(container.querySelectorAll("article")).toHaveLength(120);
    });
    observer.disconnect();

    // 一次数据到达：卡片数从 0 直接到 120，中间没有 1..119 的分批提交。
    expect(counts).toContain(120);
    expect(counts.filter((n) => n > 0 && n < 120)).toEqual([]);
    expect(screen.getByText("便签-1")).toBeInTheDocument();
    expect(screen.getByText("便签-120")).toBeInTheDocument();
    expect(screen.getAllByText("置顶").length).toBeGreaterThan(0);
    expect(screen.queryByText("加载更多")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /下一页|上一页/ })).not.toBeInTheDocument();
  });

  it("notes_page_pinned_sort_before_updated_at", async () => {
    // Notes.tsx 按 list_notes 的数组 notes.map，页面不另排。
    // mock 顺序即 SQL：pinned DESC, updated_at DESC, id DESC。
    const rows: Note[] = [
      note(4, "Y2b", 1, "2026-01-02 09:00:00", "pink"),
      note(3, "Y2", 1, "2026-01-02 09:00:00", "green"),
      note(2, "Y", 1, "2026-01-01 09:00:00", "blue"),
      note(5, "X2", 0, "2026-01-03 12:00:00", "orange"),
      note(1, "X", 0, "2026-01-03 12:00:00", "yellow"),
    ];
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_notes") return rows;
      return null;
    });

    renderNotes();

    await waitFor(() => {
      expect(screen.getByText("Y")).toBeInTheDocument();
    });

    const articles = screen.getAllByRole("article");
    const contents = articles.map((el) => {
      const paragraph = el.querySelector("p");
      return paragraph?.textContent ?? "";
    });
    expect(contents).toEqual(["Y2b", "Y2", "Y", "X2", "X"]);

    const y = screen.getByText("Y");
    const x = screen.getByText("X");
    expect(
      y.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("notes_page_does_not_remount_cards_on_scroll", async () => {
    const notes = makeNotes(120);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_notes") return notes;
      return null;
    });

    const { container } = renderNotes();
    await waitFor(() => {
      expect(container.querySelectorAll("article")).toHaveLength(120);
    });

    const before = Array.from(container.querySelectorAll("article"));
    const labels = before.map((el) => el.querySelector("p")?.textContent);
    expect(labels).toHaveLength(120);
    expect(new Set(labels).size).toBe(120);

    const grid = container.querySelector(".grid") as HTMLElement;
    grid.scrollTop = 800;
    fireEvent.scroll(grid);
    fireEvent.scroll(window);

    await act(async () => {
      await Promise.resolve();
    });

    const listCalls = mockedInvoke.mock.calls.filter((call) => call[0] === "list_notes");
    expect(listCalls).toHaveLength(1);

    const after = Array.from(container.querySelectorAll("article"));
    expect(after).toHaveLength(120);
    after.forEach((el, i) => {
      expect(el).toBe(before[i]);
    });
    expect(after.map((el) => el.querySelector("p")?.textContent)).toEqual(labels);
  });

  it("notes_page_render_is_single_pass_with_memo", async () => {
    // 卡片在 NoteCard.tsx：export default memo(NoteCard)。
    // Notes 本身不是 memo，仍一次 notes.map 提交 120 条。无虚拟化、无分批 setState。
    // 超过约 500 条再评估虚拟化，并同步改本测试与 AGENTS.md。
    expect(typeof Notes).toBe("function");
    expect((Notes as { $$typeof?: unknown }).$$typeof).toBeUndefined();

    const src = readFileSync(resolve("src/pages/Notes.tsx"), "utf8");
    expect(src).toMatch(/notes\.map/);
    expect(src).not.toMatch(/\bmemo\s*\(/);
    expect(src).not.toMatch(/react-window|react-virtuoso|IntersectionObserver|onScroll/);
    const cardSrc = readFileSync(resolve("src/components/NoteCard.tsx"), "utf8");
    expect(cardSrc).toMatch(/export default memo\(NoteCard/);

    const notes = makeNotes(120);
    let resolveNotes: (rows: Note[]) => void = () => {};
    const pending = new Promise<Note[]>((resolve) => {
      resolveNotes = resolve;
    });
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_notes") return pending;
      return null;
    });

    const articleCounts: number[] = [];
    const phases: string[] = [];
    const onRender: ProfilerOnRenderCallback = (_id, phase) => {
      phases.push(phase);
      articleCounts.push(document.querySelectorAll("article").length);
    };

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { container } = render(
      <QueryClientProvider client={client}>
        <Profiler id="notes" onRender={onRender}>
          <Notes />
        </Profiler>
      </QueryClientProvider>,
    );

    const observer = new MutationObserver(() => {
      articleCounts.push(container.querySelectorAll("article").length);
    });
    observer.observe(container, { childList: true, subtree: true });

    await act(async () => {
      resolveNotes(notes);
      await pending;
    });
    await waitFor(() => {
      expect(container.querySelectorAll("article")).toHaveLength(120);
    });
    observer.disconnect();

    expect(articleCounts.filter((n) => n > 0 && n < 120)).toEqual([]);
    expect(articleCounts).toContain(120);
    expect(phases.every((phase) => phase === "mount" || phase === "update")).toBe(true);
  });

  it("notes_page_pinned_toggle_rerenders_only_affected_card", async () => {
    // jsx 运行时数 <article> 的创建次数。memo 按字段比较后，只有被点的那张会再建一次。
    // 本 mock 不重排，DOM 节点按下标仍是同一批。
    const targetId = 7;
    let rows = makeNotes(120).map((n) => ({
      ...n,
      pinned: n.id === targetId ? 0 : 1,
    }));
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "list_notes") return rows.map((n) => ({ ...n }));
      if (cmd === "update_note") {
        const input = args as { id: number; payload: { pinned?: boolean } };
        rows = rows.map((n) =>
          n.id === input.id ? { ...n, pinned: input.payload.pinned ? 1 : 0 } : n,
        );
        return rows.find((n) => n.id === input.id) ?? null;
      }
      return null;
    });

    const { container } = renderNotes();
    await waitFor(() => {
      expect(container.querySelectorAll("article")).toHaveLength(120);
    });

    const othersBefore = paragraphTexts(container).filter((text) => text !== `便签-${targetId}`);
    const nodesBefore = Array.from(container.querySelectorAll("article"));
    articleCounter.n = 0;

    const card = screen.getByText(`便签-${targetId}`).closest("article");
    expect(card).not.toBeNull();
    await userEvent.setup().click(within(card as HTMLElement).getByRole("button", { name: "置顶" }));

    await waitFor(() => {
      expect(within(card as HTMLElement).getByRole("button", { name: "取消置顶" })).toBeInTheDocument();
    });

    const updateCalls = mockedInvoke.mock.calls.filter((call) => call[0] === "update_note");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.[1]).toEqual({
      id: targetId,
      payload: { pinned: true },
    });

    const othersAfter = paragraphTexts(container).filter((text) => text !== `便签-${targetId}`);
    expect(othersAfter).toEqual(othersBefore);
    const nodesAfter = Array.from(container.querySelectorAll("article"));
    nodesAfter.forEach((el, i) => {
      expect(el).toBe(nodesBefore[i]);
    });

    const listCalls = mockedInvoke.mock.calls.filter((call) => call[0] === "list_notes");
    expect(listCalls.length).toBeGreaterThan(1);

    // 只有被点击的那张卡片应重新创建。整表 map 会让这里大于 1。
    expect(articleCounter.n).toBeLessThanOrEqual(1);
  });
});

function paragraphTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("article")).map(
    (el) => el.querySelector("p")?.textContent ?? "",
  );
}

function note(
  id: number,
  content: string,
  pinned: number,
  updatedAt: string,
  color: string,
): Note {
  return {
    id,
    content,
    color,
    pinned,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}
