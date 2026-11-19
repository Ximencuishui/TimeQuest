import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrerequisiteConflict } from "../../types";
import { PrerequisiteAdvice } from "../PrerequisiteAdvice";

const mockedInvoke = vi.mocked(invoke);

function conflict(
  overrides: Partial<PrerequisiteConflict> = {},
): PrerequisiteConflict {
  return {
    kind: "order_swapped",
    topicId: "cnm_001",
    topicName: "三角函数",
    prerequisiteId: "cnm_002",
    prerequisiteName: "函数",
    strength: "hard",
    prerequisiteTaskId: 4,
    prerequisiteTaskTitle: "三角函数",
    prerequisiteTaskRemaining: null,
    dependentSessionDate: "2026-11-20",
    prerequisiteSessionDate: null,
    message: "「三角函数」要先会「函数」，但「函数」排在这个考点后面了。",
    ...overrides,
  };
}

function renderAdvice() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PrerequisiteAdvice taskId={4} />
    </QueryClientProvider>,
  );
}

describe("PrerequisiteAdvice", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_task_prerequisite_conflicts") return [];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("prerequisite_advice_shows_nothing_when_there_is_no_conflict", async () => {
    renderAdvice();

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "list_task_prerequisite_conflicts",
        { pluginId: "cn-knowledge-graph", taskId: 4 },
      );
    });
    expect(screen.queryByText("排期建议")).not.toBeInTheDocument();
  });

  it("prerequisite_advice_lists_an_order_swapped_conflict", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_task_prerequisite_conflicts") return [conflict()];
      return null;
    });

    renderAdvice();

    expect(await screen.findByText("排期建议")).toBeInTheDocument();
    expect(screen.getByText("顺序反了")).toBeInTheDocument();
    expect(
      screen.getByText("「三角函数」要先会「函数」，但「函数」排在这个考点后面了。"),
    ).toBeInTheDocument();
  });

  it("prerequisite_advice_shows_the_prerequisite_task_and_remaining_units", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_task_prerequisite_conflicts") {
        return [
          conflict({
            kind: "prerequisite_task_incomplete",
            prerequisiteTaskId: 9,
            prerequisiteTaskTitle: "函数基础",
            prerequisiteTaskRemaining: 3,
            prerequisiteSessionDate: "2026-12-01",
            message:
              "「三角函数」要先会「函数」，「函数」还在《函数基础》里没学完（还差 3 课），而这个任务 11月20日 就开课。",
          }),
        ];
      }
      return null;
    });

    renderAdvice();

    expect(await screen.findByText("先修没学完")).toBeInTheDocument();
    const source = screen.getByLabelText("先修任务");
    expect(source).toHaveTextContent("函数基础");
    expect(source).toHaveTextContent("还差 3 课");
  });

  it("prerequisite_advice_does_not_ask_for_a_missing_task", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <PrerequisiteAdvice taskId={null} />
      </QueryClientProvider>,
    );

    expect(mockedInvoke).not.toHaveBeenCalledWith(
      "list_task_prerequisite_conflicts",
      expect.anything(),
    );
    expect(screen.queryByText("排期建议")).not.toBeInTheDocument();
  });
});
