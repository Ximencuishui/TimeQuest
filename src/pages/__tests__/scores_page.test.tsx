import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_PROFILE } from "../../lib/profile";
import type { CreateExamRecordPayload, ExamRecord, UserProfile } from "../../types";
import { Scores } from "../Scores";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
      <div style={{ width: 480, height: 288 }}>
        {Children.map(children, (child) => {
          if (!isValidElement(child)) return child;
          return cloneElement(child as ReactElement<{ width?: number; height?: number }>, {
            width: 480,
            height: 288,
          });
        })}
      </div>
    ),
  };
});

const mockedInvoke = vi.mocked(invoke);

const PROFILE: UserProfile = {
  ...DEFAULT_USER_PROFILE,
  region: "湖南省",
};

const EXAM_NAME = "2026届高三上期中考";

function renderScores() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Scores />
    </QueryClientProvider>,
  );
}

describe("Scores entry", () => {
  let records: ExamRecord[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0));
    records = [];
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_user_profile") return PROFILE;
      if (cmd === "list_exam_records") return records;
      if (cmd === "create_exam_record") {
        const payload = (args as { payload: CreateExamRecordPayload }).payload;
        const row: ExamRecord = {
          id: records.length + 1,
          ...payload,
          created_at: "2026-11-06 13:00:00",
        };
        records = [row, ...records];
        return row;
      }
      if (cmd === "delete_exam_record") {
        const id = (args as { id: number }).id;
        records = records.filter((row) => row.id !== id);
        return null;
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("scores_entry_submits_name_date_and_every_subject", async () => {
    renderScores();
    await waitFor(() => {
      expect(screen.getByText("高三 · 湖南 · 历次考试")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "录入新成绩" }));
    const date = screen.getByLabelText("考试日期");
    expect(date).toHaveValue("2026-11-06");
    expect(screen.getByText(/按你的档案（高三 · 湖南）录入这六科/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("考试名称"), {
      target: { value: EXAM_NAME },
    });
    fireEvent.change(screen.getByLabelText("语文"), { target: { value: "110" } });
    fireEvent.change(screen.getByLabelText("数学"), { target: { value: "130" } });
    fireEvent.change(screen.getByLabelText("英语"), { target: { value: "115" } });
    fireEvent.change(screen.getByLabelText("物理"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("化学"), { target: { value: "75" } });

    fireEvent.click(screen.getByRole("button", { name: "保存成绩" }));

    await waitFor(() => {
      const calls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "create_exam_record",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({
        payload: {
          exam_name: EXAM_NAME,
          exam_date: "2026-11-06",
          chinese_score: 110,
          math_score: 130,
          english_score: 115,
          physics_score: 70,
          chemistry_score: 75,
          biology_score: null,
        },
      });
    });

    expect(await screen.findByRole("heading", { name: EXAM_NAME })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "录入新成绩" })).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("score_inputs_keep_digits_and_warn_past_the_soft_max", async () => {
    renderScores();
    fireEvent.click(await screen.findByRole("button", { name: "录入新成绩" }));

    const chinese = screen.getByLabelText("语文");
    fireEvent.change(chinese, { target: { value: "1a2b" } });
    expect(chinese).toHaveValue("12");
    fireEvent.change(chinese, { target: { value: "abc" } });
    expect(chinese).toHaveValue("");

    fireEvent.change(screen.getByLabelText("考试名称"), {
      target: { value: EXAM_NAME },
    });
    expect(screen.getByRole("button", { name: "保存成绩" })).toBeDisabled();
    expect(screen.getByText("请至少填写一科成绩")).toBeInTheDocument();

    fireEvent.change(chinese, { target: { value: "160" } });
    expect(chinese).toHaveValue("160");
    expect(screen.getByText(/语文 160 分高于常见单科上限 150/)).toBeInTheDocument();
    expect(screen.getByText(/仍可保存/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存成绩" })).toBeEnabled();

    for (const label of ["数学", "英语", "物理", "化学", "生物"]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: "150" } });
    }
    expect(screen.getByText(/已填合计 910，高于常见总分上限 750/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存成绩" })).toBeEnabled();
  });

  it("deleting_the_last_record_returns_to_the_empty_state", async () => {
    const only: ExamRecord = {
      id: 7,
      exam_name: "月考",
      exam_date: "2026-09-01",
      chinese_score: 100,
      math_score: 120,
      english_score: 100,
      physics_score: 70,
      chemistry_score: 70,
      biology_score: 70,
      created_at: "2026-09-01 12:00:00",
    };
    records = [only];
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderScores();
    expect(await screen.findByTestId("score-trend-chart")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "月考" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(
      await screen.findByText("还没有成绩记录。记下一次考试后，这里会画出和目标的距离。"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("score-trend-chart")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "月考" })).not.toBeInTheDocument();
  });
});
