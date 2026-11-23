import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_PROFILE } from "../../lib/profile";
import { SUBJECT_FIXTURES, examSession } from "../../test/subjectFixtures";
import type { CreateExamSessionPayload, ExamSession, Subject, Track, UserProfile } from "../../types";
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

/** 另一条赛道的科目：换赛道后成绩页只认这一套。 */
const KAOYAN_SUBJECTS: Subject[] = [
  { id: 21, key: "politics", label: "政治", fullMark: 100, goal: 70, unit: "分", orderIndex: 0, trackId: 2 },
  { id: 22, key: "english", label: "英语", fullMark: 100, goal: 65, unit: "分", orderIndex: 1, trackId: 2 },
  { id: 23, key: "math", label: "数学", fullMark: 150, goal: 120, unit: "分", orderIndex: 2, trackId: 2 },
];

const KAOYAN_TRACK: Track = {
  id: 2,
  name: "考研",
  kind: "exam",
  scoreMode: "total",
  isPrimary: true,
  color: null,
  createdAt: "2026-11-06 12:00:00",
};

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
  let sessions: ExamSession[];
  let tracks: Track[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0));
    sessions = [];
    tracks = [];
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_user_profile") return PROFILE;
      if (cmd === "list_tracks") return tracks;
      if (cmd === "list_subjects") {
        // 科目按赛道筛：给了赛道 id 就只回这条赛道的科目。
        const trackId = (args as { trackId?: number | null } | undefined)?.trackId ?? null;
        if (trackId == null) return SUBJECT_FIXTURES;
        return KAOYAN_SUBJECTS.filter((subject) => subject.trackId === trackId);
      }
      if (cmd === "list_exam_sessions") return sessions;
      if (cmd === "create_exam_session") {
        const payload = (args as { payload: CreateExamSessionPayload }).payload;
        const row: ExamSession = {
          id: sessions.length + 1,
          trackId: null,
          name: payload.name,
          date: payload.date,
          createdAt: "2026-11-06 13:00:00",
          scores: payload.scores.map((row, index) => ({
            id: index + 1,
            examId: sessions.length + 1,
            subjectId: SUBJECT_FIXTURES[index]?.id ?? index + 1,
            score: row.score,
          })),
        };
        sessions = [row, ...sessions];
        return row;
      }
      if (cmd === "delete_exam_session") {
        const id = (args as { id: number }).id;
        sessions = sessions.filter((row) => row.id !== id);
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
    expect(screen.getByText(/按你的档案（高三 · 湖南）录入这 6 科/)).toBeInTheDocument();

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
        (call) => call[0] === "create_exam_session",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({
        payload: {
          name: EXAM_NAME,
          date: "2026-11-06",
          scores: [
            { subjectKey: "chinese", score: 110 },
            { subjectKey: "math", score: 130 },
            { subjectKey: "english", score: 115 },
            { subjectKey: "physics", score: 70 },
            { subjectKey: "chemistry", score: 75 },
            { subjectKey: "biology", score: null },
          ],
        },
      });
    });

    expect(await screen.findByRole("heading", { name: EXAM_NAME })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "录入新成绩" })).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    // 生物没考：实考 500 / 530，按比例折算为 575 / 610。
    expect(screen.getByTestId("scaled-total-note")).toHaveTextContent(
      "实考 500 / 530 · 折算 575 / 610",
    );
    expect(screen.getByText(/缺考 生物 · 按已考科目比例折算/)).toBeInTheDocument();
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

  it("renders_only_the_subjects_of_the_active_track", async () => {
    // 主赛道换成「考研」：成绩页的科目清单跟着换，不再是高考六科。
    tracks = [KAOYAN_TRACK];

    renderScores();
    fireEvent.click(await screen.findByRole("button", { name: "录入新成绩" }));

    // 赛道数据到位后科目集合才会换成这一套：等它，别抢在前一版。
    await waitFor(() => {
      expect(screen.getByText(/按你的档案（高三 · 湖南）录入这 3 科/)).toBeInTheDocument();
    });
    expect(screen.getByLabelText("政治")).toBeInTheDocument();
    expect(screen.getByLabelText("英语")).toBeInTheDocument();
    expect(screen.getByLabelText("数学")).toBeInTheDocument();
    // 高考那几科不在这条赛道里，不该出现。
    expect(screen.queryByLabelText("语文")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("物理")).not.toBeInTheDocument();
  });

  it("deleting_the_last_record_returns_to_the_empty_state", async () => {
    const only = examSession(7, "月考", "2026-09-01", [100, 120, 100, 70, 70, 70]);
    sessions = [only];
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
