import { useSyncExternalStore } from "react";
import { vi } from "vitest";
import type { Goal, UpsertGoalPayload } from "../types";

/**
 * 测试里的目标假数据。
 *
 * 目标 4.0 起落在数据库里，测试里没法真写库，
 * 所以把 `hooks/useGoals` 整个换成本模块（见各测试文件顶部的 `vi.mock`）。
 */
let fixtures: Goal[] = [];
const listeners = new Set<() => void>();

/** 造一条默认目标，测试里只关心 name / date / isPrimary 时用它。 */
export function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 1,
    trackId: null,
    name: "高考",
    date: "2027-06-07",
    kind: "exam",
    isPrimary: true,
    targetScore: null,
    createdAt: "2026-11-04 12:00:00",
    ...overrides,
  };
}

/** 换掉当前的目标列表，订阅的组件会跟着重渲染。 */
export function setGoalFixtures(next: Goal[]): void {
  fixtures = next;
  listeners.forEach((listener) => listener());
}

export function getGoalFixtures(): Goal[] {
  return fixtures;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// 模块级常量：组件把 `upsert.mutate` 放进 useEffect 依赖，引用必须稳定。
// 三个 mutation 都直接改假数据，这样组件重渲染后能读到新值（相当于真写库）。
export const upsert = {
  mutate: vi.fn((payload: UpsertGoalPayload) => {
    const existing =
      payload.id != null ? fixtures.find((goal) => goal.id === payload.id) : undefined;
    if (existing) {
      setGoalFixtures(
        fixtures.map((goal) =>
          goal.id === existing.id
            ? {
                ...goal,
                name: payload.name,
                date: payload.date,
                kind: payload.kind ?? goal.kind,
                isPrimary: payload.isPrimary ?? goal.isPrimary,
                targetScore: payload.clearTargetScore
                  ? null
                  : (payload.targetScore ?? goal.targetScore),
              }
            : goal,
        ),
      );
      return;
    }
    const nextId = fixtures.reduce((max, goal) => Math.max(max, goal.id), 0) + 1;
    setGoalFixtures([
      ...fixtures,
      makeGoal({
        id: nextId,
        name: payload.name,
        date: payload.date,
        kind: payload.kind ?? "exam",
        isPrimary: payload.isPrimary ?? false,
        targetScore: payload.targetScore ?? null,
      }),
    ]);
  }),
  mutateAsync: vi.fn(),
  isPending: false,
};
export const remove = {
  mutate: vi.fn((id: number) => {
    setGoalFixtures(fixtures.filter((goal) => goal.id !== id));
  }),
  mutateAsync: vi.fn(),
  isPending: false,
};
export const setPrimary = {
  mutate: vi.fn((id: number) => {
    setGoalFixtures(
      fixtures.map((goal) => ({ ...goal, isPrimary: goal.id === id })),
    );
  }),
  mutateAsync: vi.fn(),
  isPending: false,
};

/** 清掉假数据和 mock 调用记录。 */
export function resetGoalMocks(): void {
  upsert.mutate.mockClear();
  upsert.mutateAsync.mockClear();
  remove.mutate.mockClear();
  remove.mutateAsync.mockClear();
  setPrimary.mutate.mockClear();
  setPrimary.mutateAsync.mockClear();
  setGoalFixtures([]);
}

export function useGoals() {
  return {
    data: useSyncExternalStore(subscribe, getGoalFixtures, getGoalFixtures),
    isLoading: false,
  };
}

export function useGoalMutations() {
  return { upsert, remove, setPrimary };
}

export function useGoalsMigration(): void {
  /* 测试里不真的搬 localStorage 的旧数据 */
}