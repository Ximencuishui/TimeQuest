import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Goal,
  Subject,
  Track,
  UpsertGoalPayload,
  UpsertSubjectPayload,
  UpsertTrackPayload,
} from "../../types";
import { TrackSetting } from "../TrackSetting";

const mockedInvoke = vi.mocked(invoke);

/** mock 里新建赛道返回的 id：tracks.length + 10（列表两条 → 12）。 */
const NEW_TRACK_ID = 12;

function makeTracks(): Track[] {
  return [
    {
      id: 1,
      name: "高考",
      kind: "exam",
      scoreMode: "total",
      isPrimary: true,
      color: null,
      createdAt: "2026-11-06 12:00:00",
    },
    {
      id: 2,
      name: "考研",
      kind: "exam",
      scoreMode: "total",
      isPrimary: false,
      color: null,
      createdAt: "2026-11-06 12:00:00",
    },
  ];
}

function renderSetting() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TrackSetting />
    </QueryClientProvider>,
  );
}

describe("学习方向设置", () => {
  let tracks: Track[];
  let goals: Goal[];
  let subjects: Subject[];
  let trackUpserts: UpsertTrackPayload[];
  let goalUpserts: UpsertGoalPayload[];
  let subjectUpserts: UpsertSubjectPayload[];

  beforeEach(() => {
    tracks = makeTracks();
    goals = [
      {
        id: 1,
        trackId: 1,
        name: "高考",
        date: "2027-06-07",
        kind: "exam",
        isPrimary: true,
        targetScore: 610,
        createdAt: "2026-11-06 12:00:00",
      },
    ];
    subjects = [];
    trackUpserts = [];
    goalUpserts = [];
    subjectUpserts = [];
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "list_tracks") return tracks;
      if (cmd === "list_goals") return goals;
      if (cmd === "list_subjects") return subjects;
      if (cmd === "upsert_track") {
        const payload = (args as { payload: UpsertTrackPayload }).payload;
        trackUpserts.push(payload);
        const next: Track = {
          id: payload.id ?? tracks.length + 10,
          name: payload.name,
          kind: payload.kind ?? "exam",
          scoreMode: payload.scoreMode ?? "total",
          isPrimary: payload.isPrimary ?? false,
          color: payload.color ?? null,
          createdAt: "2026-11-06 12:00:00",
        };
        tracks = payload.isPrimary
          ? [next, ...tracks.filter((track) => track.id !== next.id).map((track) => ({ ...track, isPrimary: false }))]
          : tracks;
        return next;
      }
      if (cmd === "upsert_goal") {
        const payload = (args as { payload: UpsertGoalPayload }).payload;
        goalUpserts.push(payload);
        return { id: payload.id ?? 1, createdAt: "2026-11-06 12:00:00", ...payload };
      }
      if (cmd === "upsert_subject") {
        const payload = (args as { payload: UpsertSubjectPayload }).payload;
        subjectUpserts.push(payload);
        return {
          id: payload.id ?? subjects.length + 1,
          key: payload.key ?? "subject",
          label: payload.label,
          fullMark: payload.fullMark ?? null,
          goal: payload.goal ?? null,
          unit: payload.unit ?? null,
          orderIndex: subjects.length,
          trackId: payload.trackId ?? null,
        };
      }
      if (cmd === "remove_track") {
        const id = (args as { id: number }).id;
        tracks = tracks.filter((track) => track.id !== id);
        return null;
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("lists_the_tracks_and_marks_the_active_one", async () => {
    renderSetting();
    // 「当前」只出现在赛道列表里：等它出现才说明列表数据真的到了。
    // 不能用「高考」当等待条件——模板下拉的 <option> 里也有它，会提前放行。
    expect(await screen.findByText("当前")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("高考");
    expect(items[1]).toHaveTextContent("考研");
    // 只有主赛道带「当前」徽章。
    expect(items[0]).toHaveTextContent("当前");
    expect(items[1]).not.toHaveTextContent("当前");
  });

  it("switching_to_another_track_makes_it_primary_and_moves_the_goal", async () => {
    renderSetting();
    const switchButton = await screen.findByRole("button", { name: "切换" });

    fireEvent.click(switchButton);

    await waitFor(() => {
      expect(trackUpserts).toHaveLength(1);
    });
    expect(trackUpserts[0]).toMatchObject({
      id: 2,
      name: "考研",
      isPrimary: true,
    });
    // 主目标跟着主赛道走，否则倒计时还挂在上一条赛道上。
    await waitFor(() => {
      expect(goalUpserts).toHaveLength(1);
    });
    expect(goalUpserts[0]).toMatchObject({ id: 1, trackId: 2, isPrimary: true });
    await waitFor(() => {
      expect(screen.getByText(/已切换到「考研」/)).toBeInTheDocument();
    });
  });

  it("creating_a_track_seeds_the_template_subjects", async () => {
    renderSetting();
    // 选「高考」模板再新建：科目按模板铺一套。
    const template = await screen.findByLabelText("模板");
    fireEvent.change(template, { target: { value: "gaokao" } });
    fireEvent.click(screen.getByRole("button", { name: "新建并切换" }));

    await waitFor(() => {
      expect(trackUpserts).toHaveLength(1);
    });
    expect(trackUpserts[0]).toMatchObject({ name: "高考", kind: "exam", isPrimary: true });

    await waitFor(() => {
      expect(subjectUpserts).toHaveLength(6);
    });
    expect(subjectUpserts.map((payload) => payload.key)).toEqual([
      "chinese",
      "math",
      "english",
      "physics",
      "chemistry",
      "biology",
    ]);
    // 科目挂在新赛道上。
    for (const payload of subjectUpserts) {
      expect(payload.trackId).toBe(NEW_TRACK_ID);
    }
    expect(subjectUpserts.find((payload) => payload.key === "math")).toMatchObject({
      label: "数学",
      fullMark: 130,
      goal: 130,
    });
  });

  it("deleting_a_track_keeps_history_and_reports_it", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSetting();
    const deleteButtons = await screen.findAllByRole("button", { name: "删除" });
    fireEvent.click(deleteButtons[0]);
    await waitFor(() => {
      expect(screen.getByText(/已删除「/)).toBeInTheDocument();
    });
    confirm.mockRestore();
  });
});
