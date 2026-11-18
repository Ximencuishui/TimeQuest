import { describe, expect, it } from "vitest";
import { MAX_DAILY_STUDY_MINUTES } from "../constants";
import {
  BASE_UNIT_XP,
  RESCHEDULE_RECOVERY_BONUS,
  xpRequiredForLevel,
} from "../gamification";
import { GLOSSARY, glossaryEntry } from "../glossary";
import {
  DEFAULT_DAILY_LIMIT_MINUTES,
  MIN_DAILY_LIMIT_MINUTES,
} from "../studyPlan";

describe("术语词条", () => {
  it("glossary_entries_have_unique_ids_and_complete_text", () => {
    const ids = GLOSSARY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const entry of GLOSSARY) {
      expect(entry.term.trim().length).toBeGreaterThan(0);
      expect(entry.question.trim().length).toBeGreaterThan(0);
      expect(entry.summary.trim().length).toBeGreaterThan(0);
      // 每个词条都要能回答「这个数从哪来」。
      expect(
        (entry.formula?.trim().length ?? 0) + (entry.source?.trim().length ?? 0),
      ).toBeGreaterThan(0);
    }
  });

  it("glossary_xp_formula_matches_gamification_constants", () => {
    const entry = glossaryEntry("xp");
    expect(entry).not.toBeNull();
    expect(entry!.formula).toContain(String(BASE_UNIT_XP.main));
    expect(entry!.formula).toContain(String(BASE_UNIT_XP.side));
    expect(entry!.formula).toContain(`+${RESCHEDULE_RECOVERY_BONUS} XP`);
  });

  it("glossary_level_formula_matches_level_curve", () => {
    const entry = glossaryEntry("level");
    expect(entry).not.toBeNull();
    expect(entry!.formula).toContain(String(xpRequiredForLevel(1)));
    expect(entry!.formula).toContain(String(xpRequiredForLevel(2)));
    expect(entry!.formula).toContain(String(xpRequiredForLevel(3)));
  });

  it("glossary_daily_limit_matches_settings_bounds", () => {
    const entry = glossaryEntry("daily_limit");
    expect(entry).not.toBeNull();
    expect(entry!.formula).toContain(`${DEFAULT_DAILY_LIMIT_MINUTES / 60} 小时`);
    expect(entry!.formula).toContain(
      `${MIN_DAILY_LIMIT_MINUTES}–${MAX_DAILY_STUDY_MINUTES} 分钟`,
    );
  });

  it("glossary_covers_the_numbers_students_ask_about", () => {
    const ids = GLOSSARY.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "xp",
        "level",
        "streak",
        "self_rating",
        "progress_ring",
        "completion_rate",
        "remaining",
        "rescheduled",
      ]),
    );
  });

  it("glossary_unknown_id_returns_null", () => {
    expect(glossaryEntry("not-a-term")).toBeNull();
  });
});
