import { describe, expect, it } from "vitest";
import { MAX_DAILY_STUDY_MINUTES } from "../constants";
import {
  DEFAULT_DAILY_LIMIT_MINUTES,
  DEFAULT_DAILY_SLOTS,
  dailySlotMinutes,
  parseDailyLimit,
  parseDailySlots,
  serializeDailySlots,
} from "../studyPlan";

describe("studyPlan", () => {
  it("parse_daily_slots_returns_defaults_when_unset", () => {
    expect(parseDailySlots(null)).toEqual(DEFAULT_DAILY_SLOTS);
    expect(parseDailySlots(undefined)).toEqual(DEFAULT_DAILY_SLOTS);
    expect(parseDailySlots("")).toEqual(DEFAULT_DAILY_SLOTS);
  });

  it("parse_daily_slots_falls_back_on_broken_payload", () => {
    expect(parseDailySlots("{oops")).toEqual(DEFAULT_DAILY_SLOTS);
    expect(parseDailySlots('{"a":1}')).toEqual(DEFAULT_DAILY_SLOTS);
  });

  it("parse_daily_slots_reads_pairs_and_drops_invalid", () => {
    expect(
      parseDailySlots('[["08:00","09:00"],["20:00","19:00"],["bad","time"],["10:00","10:00"]]'),
    ).toEqual([{ start: "08:00", end: "09:00" }]);
  });

  it("parse_daily_slots_accepts_object_form", () => {
    expect(parseDailySlots('[{"start":"08:00","end":"09:00"}]')).toEqual([
      { start: "08:00", end: "09:00" },
    ]);
  });

  it("serialize_daily_slots_round_trips", () => {
    const slots = [
      { start: "07:00", end: "08:00" },
      { start: "20:00", end: "21:00" },
    ];
    expect(parseDailySlots(serializeDailySlots(slots))).toEqual(slots);
  });

  it("parse_daily_limit_clamps_and_defaults", () => {
    expect(parseDailyLimit(null)).toBe(DEFAULT_DAILY_LIMIT_MINUTES);
    expect(parseDailyLimit("")).toBe(DEFAULT_DAILY_LIMIT_MINUTES);
    expect(parseDailyLimit("abc")).toBe(DEFAULT_DAILY_LIMIT_MINUTES);
    expect(parseDailyLimit("0")).toBe(DEFAULT_DAILY_LIMIT_MINUTES);
    expect(parseDailyLimit("600")).toBe(600);
    expect(parseDailyLimit("99999")).toBe(MAX_DAILY_STUDY_MINUTES);
    expect(parseDailyLimit("10")).toBe(60);
  });

  it("daily_slot_minutes_sums_valid_slots", () => {
    expect(dailySlotMinutes(DEFAULT_DAILY_SLOTS)).toBe(180);
    expect(dailySlotMinutes([{ start: "08:00", end: "08:00" }])).toBe(0);
    expect(dailySlotMinutes([])).toBe(0);
  });
});
