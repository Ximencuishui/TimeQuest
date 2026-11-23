import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_PROFILE,
  canonicalProvince,
  parseProfileDraft,
  profileLine,
  profileToDraft,
  shortRegion,
  targetHint,
} from "../profile";
import { SUBJECT_FIXTURES } from "../../test/subjectFixtures";

describe("profile line", () => {
  it("shortens a province suffix for the sidebar", () => {
    expect(shortRegion("湖南省")).toBe("湖南");
    expect(shortRegion("北京市")).toBe("北京");
    expect(shortRegion("内蒙古自治区")).toBe("内蒙古");
    expect(shortRegion("湖南")).toBe("湖南");
    expect(profileLine("高三", "湖南省")).toBe("高三 · 湖南");
    expect(profileLine("高三", "")).toBe("高三");
    expect(profileLine("", "")).toBe("");
  });

  it("canonical province keeps the 34 short names", () => {
    expect(canonicalProvince("湖南")).toBe("湖南");
    expect(canonicalProvince("湖南省")).toBe("湖南");
    expect(canonicalProvince("新疆维吾尔自治区")).toBe("新疆");
    expect(canonicalProvince("香港特别行政区")).toBe("香港");
    expect(canonicalProvince("火星")).toBeNull();
    expect(canonicalProvince("  ")).toBeNull();
    const parsed = parseProfileDraft(
      profileToDraft({ ...DEFAULT_USER_PROFILE, region: "广东省" }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.profile.region).toBe("广东");
  });

  it("各科目标合计与总分目标一致", () => {
    // 4.0 起各科目标落在 `subjects` 表：种子六科的合计要跟总分目标对得上。
    const sum = SUBJECT_FIXTURES.reduce(
      (total, subject) => total + (subject.goal ?? 0),
      0,
    );
    expect(sum).toBe(DEFAULT_USER_PROFILE.total_target);
    expect(targetHint(610, 610)).toBe("各科合计 610，与总分目标一致");
    expect(targetHint(620, 610)).toBe("各科合计 620，比总分目标多 10 分");
    expect(targetHint(600, 610)).toBe("各科合计 600，比总分目标少 10 分");
  });
});
