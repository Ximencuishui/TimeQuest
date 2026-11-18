import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryHint } from "../GlossaryHint";
import { GlossaryList } from "../GlossaryList";

afterEach(() => {
  cleanup();
});

describe("GlossaryHint", () => {
  it("glossary_hint_opens_the_formula_on_click", () => {
    render(<GlossaryHint id="xp" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "XP 是怎么算出来的？" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("XP（经验值）");
    expect(dialog).toHaveTextContent("口径：");
    expect(dialog).toHaveTextContent("来源：");
  });

  it("glossary_hint_renders_nothing_for_unknown_id", () => {
    const { container } = render(<GlossaryHint id="not-a-term" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("glossary_hint_closes_on_confirm", () => {
    render(<GlossaryHint id="streak" />);
    fireEvent.click(screen.getByRole("button", { name: "连击天数怎么算？" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("GlossaryList", () => {
  it("glossary_list_shows_every_term_with_its_source", () => {
    render(<GlossaryList />);

    expect(screen.getByRole("heading", { name: "术语与数字说明" })).toBeInTheDocument();
    expect(screen.getByText("XP（经验值）")).toBeInTheDocument();
    expect(screen.getByText("计划达成率")).toBeInTheDocument();
    expect(screen.getAllByText(/^口径：/).length).toBeGreaterThan(0);
  });
});
