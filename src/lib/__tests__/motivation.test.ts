import { describe, expect, it } from "vitest";
import { DEFAULT_MOTIVATIONS } from "../constants";
import { dailyMotivation, dailyMotivationIndex, resolveMotivation } from "../motivation";

describe("dailyMotivation", () => {
  it("daily_motivation_index_is_yyyymmdd_modulo_length", () => {
    expect(dailyMotivationIndex("2026-01-01", DEFAULT_MOTIVATIONS.length)).toBe(
      20260101 % DEFAULT_MOTIVATIONS.length,
    );
    expect(dailyMotivationIndex("2026-01-02", DEFAULT_MOTIVATIONS.length)).toBe(
      20260102 % DEFAULT_MOTIVATIONS.length,
    );
    expect(dailyMotivation("2026-01-01")).toBe(dailyMotivation("2026-01-01"));
    expect(dailyMotivation("2026-01-02")).not.toBe(dailyMotivation("2026-01-01"));
    expect(DEFAULT_MOTIVATIONS).toContain(dailyMotivation("2026-01-01"));
  });

  it("resolve_motivation_uses_custom_text_and_treats_blank_as_unset", () => {
    expect(resolveMotivation("我要上清华", "2026-01-01")).toBe("我要上清华");
    expect(resolveMotivation("  我要上清华  ", "2026-01-01")).toBe("我要上清华");
    expect(resolveMotivation(null, "2026-01-01")).toBe(dailyMotivation("2026-01-01"));
    expect(resolveMotivation(undefined, "2026-01-01")).toBe(dailyMotivation("2026-01-01"));
    expect(resolveMotivation("   ", "2026-01-01")).toBe(dailyMotivation("2026-01-01"));
  });
});
