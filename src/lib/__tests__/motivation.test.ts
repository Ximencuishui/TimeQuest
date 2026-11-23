import { describe, expect, it } from "vitest";
import { FALLBACK_MOTIVATIONS } from "../fallbacks";
import {
  dailyMotivation,
  dailyMotivationIndex,
  parseMotivationPack,
  resolveMotivation,
} from "../motivation";

describe("dailyMotivation", () => {
  it("daily_motivation_index_is_yyyymmdd_modulo_length", () => {
    expect(dailyMotivationIndex("2026-01-01", FALLBACK_MOTIVATIONS.length)).toBe(
      20260101 % FALLBACK_MOTIVATIONS.length,
    );
    expect(dailyMotivationIndex("2026-01-02", FALLBACK_MOTIVATIONS.length)).toBe(
      20260102 % FALLBACK_MOTIVATIONS.length,
    );
    expect(dailyMotivation("2026-01-01")).toBe(dailyMotivation("2026-01-01"));
    expect(dailyMotivation("2026-01-02")).not.toBe(dailyMotivation("2026-01-01"));
    expect(FALLBACK_MOTIVATIONS).toContain(dailyMotivation("2026-01-01"));
  });

  it("resolve_motivation_uses_custom_text_and_treats_blank_as_unset", () => {
    expect(resolveMotivation("我要上清华", "2026-01-01")).toBe("我要上清华");
    expect(resolveMotivation("  我要上清华  ", "2026-01-01")).toBe("我要上清华");
    expect(resolveMotivation(null, "2026-01-01")).toBe(dailyMotivation("2026-01-01"));
    expect(resolveMotivation(undefined, "2026-01-01")).toBe(dailyMotivation("2026-01-01"));
    expect(resolveMotivation("   ", "2026-01-01")).toBe(dailyMotivation("2026-01-01"));
  });
});

describe("parseMotivationPack", () => {
  it("reads_the_lines_out_of_a_track_pack", () => {
    const raw = JSON.stringify({
      id: "gaokao",
      name: "高考语料",
      lines: ["再坚持一下", "  ", "错题本比鸡汤有用"],
    });
    expect(parseMotivationPack(raw)).toEqual(["再坚持一下", "错题本比鸡汤有用"]);
  });

  it("treats_a_broken_pack_as_no_pack", () => {
    expect(parseMotivationPack("not json")).toEqual([]);
    expect(parseMotivationPack("[]")).toEqual([]);
    expect(parseMotivationPack("{}")).toEqual([]);
    expect(parseMotivationPack(JSON.stringify({ lines: "nope" }))).toEqual([]);
    expect(parseMotivationPack(JSON.stringify({ lines: [1, 2] }))).toEqual([]);
  });
});
