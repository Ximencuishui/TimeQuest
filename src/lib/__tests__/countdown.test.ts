import { describe, expect, it } from "vitest";
import { computeCountdown, type CountdownParts } from "../date";

/**
 * 签名：computeCountdown(targetDate: string, now?: Date) → CountdownParts。
 * 锚点是目标日本地 00:00:00。返回字段是 totalMs / isPast，没有 totalSeconds。
 */

const NUMERIC_KEYS = [
  "totalMs",
  "days",
  "weeks",
  "months",
  "hours",
  "minutes",
  "seconds",
] as const satisfies readonly (keyof CountdownParts)[];

function assertFiniteNonNegative(parts: CountdownParts) {
  for (const key of NUMERIC_KEYS) {
    const value = parts[key];
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  }
}

describe("computeCountdown", () => {
  it("compute_countdown_returns_zeros_when_target_in_past", () => {
    const now = new Date("2026-06-08T12:00:00");
    const result = computeCountdown("2026-06-07", now);

    expect(result.days).toBe(0);
    expect(result.hours).toBe(0);
    expect(result.minutes).toBe(0);
    expect(result.seconds).toBe(0);
    expect(result.weeks).toBe(0);
    expect(result.months).toBe(0);
    expect(result.totalMs).toBe(0);
    expect(result.isPast).toBe(true);
    assertFiniteNonNegative(result);
  });

  it("compute_countdown_returns_one_second_when_target_one_second_ahead", () => {
    // 锚点是 2026-06-11 本地零点。提前 1 秒在前一日 23:59:59。
    // 日历天跨日，days 为 1；同周所以 weeks 为 0。时分秒余数里只有 seconds 为 1。
    const now = new Date("2026-06-10T23:59:59");
    const result = computeCountdown("2026-06-11", now);

    expect(result.seconds).toBe(1);
    expect(result.totalMs).toBe(1000);
    expect(result.hours).toBe(0);
    expect(result.minutes).toBe(0);
    expect(result.weeks).toBe(0);
    expect(result.months).toBe(0);
    expect(result.days).toBe(1);
    expect(result.isPast).toBe(false);
    assertFiniteNonNegative(result);
  });

  it("compute_countdown_returns_zeros_when_target_equals_now", () => {
    const now = new Date("2026-06-07T00:00:00");
    const result = computeCountdown("2026-06-07", now);

    expect(result.days).toBe(0);
    expect(result.hours).toBe(0);
    expect(result.minutes).toBe(0);
    expect(result.seconds).toBe(0);
    expect(result.weeks).toBe(0);
    expect(result.months).toBe(0);
    expect(result.totalMs).toBe(0);
    expect(result.isPast).toBe(true);
    assertFiniteNonNegative(result);
  });

  it("compute_countdown_never_returns_negative_for_large_past_gap", () => {
    const now = new Date("2030-01-01T00:00:00");
    const result = computeCountdown("2020-01-01", now);

    expect(result.isPast).toBe(true);
    expect(result.days).toBe(0);
    expect(result.weeks).toBe(0);
    expect(result.months).toBe(0);
    expect(result.hours).toBe(0);
    expect(result.minutes).toBe(0);
    expect(result.seconds).toBe(0);
    expect(result.totalMs).toBe(0);
    assertFiniteNonNegative(result);
  });

  it("compute_countdown_handles_invalid_target_date", () => {
    const now = new Date("2026-06-07T09:00:00");

    expect(() => computeCountdown("not-a-date", now)).not.toThrow();

    expect(computeCountdown("not-a-date", now)).toEqual({
      totalMs: 0,
      days: 0,
      weeks: 0,
      months: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      isPast: false,
    });
  });
});
