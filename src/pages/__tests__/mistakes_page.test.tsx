import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mistake } from "../../types";
import { Mistakes } from "../Mistakes";

const mockedInvoke = vi.mocked(invoke);

function makeMistake(partial: Partial<Mistake> & { id: number }): Mistake {
  return {
    subject: "物理",
    title: "牛顿第二定律应用",
    reason: "概念不清",
    correct_note: "",
    is_mastered: 0,
    created_at: "2026-11-18 10:00:00",
    updated_at: "2026-11-18 10:00:00",
    ...partial,
  };
}

function renderMistakes() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Mistakes />
    </QueryClientProvider>,
  );
}

describe("Mistakes page", () => {
  let rows: Mistake[];
  let nextId: number;

  beforeEach(() => {
    rows = [];
    nextId = 1;
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "list_mistakes") return rows;
      if (cmd === "create_mistake") {
        const a = args as {
          subject: string;
          title: string;
          reason: string;
          correctNote: string;
        };
        const row = makeMistake({
          id: nextId++,
          subject: a.subject,
          title: a.title,
          reason: a.reason,
          correct_note: a.correctNote,
        });
        rows = [row, ...rows];
        return row;
      }
      if (cmd === "update_mistake") {
        const a = args as { id: number; payload: { isMastered?: number } };
        rows = rows.map((r) =>
          r.id === a.id
            ? { ...r, is_mastered: a.payload.isMastered ?? r.is_mastered }
            : r,
        );
        return rows.find((r) => r.id === a.id) ?? null;
      }
      if (cmd === "delete_mistake") {
        const a = args as { id: number };
        rows = rows.filter((r) => r.id !== a.id);
        return null;
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("mistakes_page_records_subject_reason_and_correct_note", async () => {
    renderMistakes();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "错题本" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("科目"), { target: { value: "化学" } });
    fireEvent.change(screen.getByLabelText("错因"), { target: { value: "审题失误" } });
    fireEvent.change(screen.getByLabelText("题目简述"), {
      target: { value: "化学平衡常数计算" },
    });
    fireEvent.change(screen.getByLabelText("正确思路（可留空）"), {
      target: { value: "先写表达式再代数值" },
    });

    fireEvent.click(screen.getByRole("button", { name: "记下来" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "create_mistake",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({
        subject: "化学",
        title: "化学平衡常数计算",
        reason: "审题失误",
        correctNote: "先写表达式再代数值",
      });
    });

    expect(
      await screen.findByRole("heading", { name: "化学平衡常数计算" }),
    ).toBeInTheDocument();
    expect(screen.getByText("正确思路：先写表达式再代数值")).toBeInTheDocument();
  });

  it("mistakes_page_refuses_to_save_without_a_title", async () => {
    renderMistakes();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "错题本" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "记下来" }));

    expect(
      screen.getByText("写一句题目简述，别人才看得懂你记的是哪道题。"),
    ).toBeInTheDocument();
    const calls = mockedInvoke.mock.calls.filter(
      (call) => call[0] === "create_mistake",
    );
    expect(calls).toHaveLength(0);
  });

  it("mistakes_page_toggles_mastered_state", async () => {
    rows = [makeMistake({ id: 1 })];
    renderMistakes();

    const card = await screen.findByTestId("mistake-card");
    expect(card).toHaveAttribute("data-mastered", "false");

    fireEvent.click(screen.getByRole("button", { name: "标记已订正" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "update_mistake",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({ id: 1, payload: { isMastered: 1 } });
    });

    await waitFor(() => {
      expect(screen.getByTestId("mistake-card")).toHaveAttribute(
        "data-mastered",
        "true",
      );
    });
    expect(screen.getByRole("button", { name: "取消订正" })).toBeInTheDocument();
  });

  it("mistakes_page_filters_pending_and_mastered", async () => {
    rows = [
      makeMistake({ id: 1, title: "还没订正的题", is_mastered: 0 }),
      makeMistake({ id: 2, title: "已经订正的题", is_mastered: 1 }),
    ];
    renderMistakes();

    await screen.findByRole("heading", { name: "还没订正的题" });
    expect(
      screen.getByText(/共 2 条 · 已订正 1 条 · 待订正 1 条/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "未订正" }));
    expect(screen.getByRole("heading", { name: "还没订正的题" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "已经订正的题" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "已订正" }));
    expect(
      screen.getByRole("heading", { name: "已经订正的题" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "还没订正的题" }),
    ).not.toBeInTheDocument();
  });

  it("mistakes_page_shows_the_empty_state", async () => {
    renderMistakes();
    expect(
      await screen.findByText("还没有错题。做错的题记下来，复习时一眼看到。"),
    ).toBeInTheDocument();
  });
});
