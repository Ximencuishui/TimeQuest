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
import { TRACK_TEMPLATES, templateGoalSum } from "../track";
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
    // 4.0 起各科目标落在 `subjects` 表：种子六科的合计要跟这条赛道的模板目标对得上。
    // 不写死具体分值——总分目标属于赛道，赛道换了合计就跟着换。
    const gaokao = TRACK_TEMPLATES.find((item) => item.id === "gaokao");
    expect(gaokao).toBeDefined();
    const total = templateGoalSum(gaokao!.subjects);
    const sum = SUBJECT_FIXTURES.reduce(
      (acc, subject) => acc + (subject.goal ?? 0),
      0,
    );
    expect(sum).toBe(total);
    expect(targetHint(total, total)).toBe(`各科合计 ${total}，与总分目标一致`);
    expect(targetHint(total + 10, total)).toBe(`各科合计 ${total + 10}，比总分目标多 10 分`);
    expect(targetHint(total - 10, total)).toBe(`各科合计 ${total - 10}，比总分目标少 10 分`);
  });

  it("未设总分目标时只报各科合计", () => {
    const sum = SUBJECT_FIXTURES.reduce(
      (acc, subject) => acc + (subject.goal ?? 0),
      0,
    );
    expect(targetHint(sum, null)).toBe(`各科合计 ${sum}，未设总分目标`);
  });

  it("档案留空总分目标时不报错", () => {
    // 总分目标属于赛道：按分科计的赛道压根没有总分，留空就是「不设」。
    const parsed = parseProfileDraft({
      ...profileToDraft(DEFAULT_USER_PROFILE),
      totalTarget: "",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.profile.total_target).toBeNull();
  });

  it("档案填了非法总分目标时报错", () => {
    const parsed = parseProfileDraft({
      ...profileToDraft(DEFAULT_USER_PROFILE),
      totalTarget: "abc",
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("总分目标");
  });
});
