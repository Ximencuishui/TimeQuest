import { describe, expect, it } from "vitest";
import {
  reviewRoundCount,
  roundName,
  roundNumberLabel,
  roundSequence,
} from "../rounds";

describe("轮次命名", () => {
  it("round_name_maps_first_round_to_textbook_learning", () => {
    // 第 1 轮是教材学习，排在第一轮复习前面。
    expect(roundName(1)).toBe("教材学习");
    expect(roundName(0)).toBe("教材学习");
  });

  it("round_name_maps_later_rounds_to_review_rounds", () => {
    expect(roundName(2)).toBe("第一轮复习");
    expect(roundName(3)).toBe("第二轮复习");
    expect(roundName(4)).toBe("第三轮复习");
  });

  it("round_name_uses_chinese_numerals_up_to_ten", () => {
    expect(roundName(11)).toBe("第十轮复习");
    // 超过十轮用阿拉伯数字，别硬凑汉字。
    expect(roundName(12)).toBe("第11轮复习");
    expect(roundNumberLabel(10)).toBe("十");
    expect(roundNumberLabel(25)).toBe("25");
  });

  it("round_sequence_lists_stages_in_order", () => {
    expect(roundSequence(3)).toEqual(["教材学习", "第一轮复习", "第二轮复习"]);
    // 总轮次至少是一轮：只有教材学习。
    expect(roundSequence(0)).toEqual(["教材学习"]);
  });

  it("review_round_count_excludes_textbook_learning", () => {
    expect(reviewRoundCount(3)).toBe(2);
    expect(reviewRoundCount(1)).toBe(0);
    expect(reviewRoundCount(0)).toBe(0);
  });
});
