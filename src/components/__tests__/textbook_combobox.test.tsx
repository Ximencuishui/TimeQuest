import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextbookCombobox } from "../TextbookCombobox";

const mockedInvoke = vi.mocked(invoke);

function renderCombobox() {
  const onChange = vi.fn();
  const onPick = vi.fn();
  render(
    <div>
      <TextbookCombobox
        subject="数学"
        value=""
        onChange={onChange}
        onPick={onPick}
      />
      <button type="button">弹窗里的其它字段</button>
    </div>,
  );
  return { onChange, onPick };
}

describe("TextbookCombobox", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_available_textbooks") {
        return [{ subject: "数学", version: "人教A版", volume: "必修第一册" }];
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("textbook_combobox_closes_when_clicking_outside", async () => {
    const user = userEvent.setup();
    renderCombobox();

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "弹窗里的其它字段" }));

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it("textbook_combobox_closes_on_blur", async () => {
    const user = userEvent.setup();
    renderCombobox();

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.tab();

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it("textbook_combobox_closes_on_escape", async () => {
    const user = userEvent.setup();
    renderCombobox();

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it("textbook_combobox_still_picks_a_suggestion_after_blur_guard", async () => {
    const user = userEvent.setup();
    const { onPick } = renderCombobox();

    await user.click(screen.getByRole("combobox"));
    const option = await screen.findByRole("option", { name: /必修第一册/ });
    await user.click(option);

    await waitFor(() => {
      expect(onPick).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it("textbook_combobox_reopens_when_the_subject_changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TextbookCombobox
        subject="数学"
        value=""
        onChange={() => undefined}
        onPick={() => undefined}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // 换科目：收起只是浮层的副作用，用户「想选书」的意图还在，列表要重新展开。
    rerender(
      <TextbookCombobox
        subject="语文"
        value=""
        onChange={() => undefined}
        onPick={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
  });

  it("textbook_combobox_stays_closed_after_escape_even_if_the_subject_changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TextbookCombobox
        subject="数学"
        value=""
        onChange={() => undefined}
        onPick={() => undefined}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    rerender(
      <TextbookCombobox
        subject="语文"
        value=""
        onChange={() => undefined}
        onPick={() => undefined}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
