import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_PROFILE } from "../../lib/profile";
import { useUiStore } from "../../store/ui";
import { ExamDateSync } from "../ExamDateSync";

const mockedInvoke = vi.mocked(invoke);

function renderSync() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ExamDateSync />
    </QueryClientProvider>,
  );
}

describe("ExamDateSync", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 6, 16, 0, 0));
    localStorage.clear();
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("exam_date_sync_replaces_default_seed_for_grade_two", async () => {
    useUiStore.getState().setExams([
      { id: "gaokao", name: "高考", date: "2027-06-07", isPrimary: true },
    ]);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_user_profile") return { ...DEFAULT_USER_PROFILE, grade: "高二", region: "湖南" };
      return null;
    });

    renderSync();

    await waitFor(() => {
      expect(useUiStore.getState().exams.find((exam) => exam.isPrimary)?.date).toBe("2028-06-07");
    });
  });

  it("exam_date_sync_keeps_a_date_the_user_already_chose", async () => {
    useUiStore.getState().setExams([
      { id: "gaokao", name: "高考", date: "2030-06-07", isPrimary: true },
    ]);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_user_profile") return { ...DEFAULT_USER_PROFILE, grade: "高二", region: "湖南" };
      return null;
    });

    renderSync();

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("get_user_profile");
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(useUiStore.getState().exams.find((exam) => exam.isPrimary)?.date).toBe("2030-06-07");
  });
});
