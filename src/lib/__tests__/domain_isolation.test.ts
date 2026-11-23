/**
 * 前端零污染护栏。
 *
 * Rust 侧有 `domain_isolation_test.rs`，前端这边补一份对称的：
 * 共享层（类型 / 常量）和纯函数内核（游戏化）不能认识具体学科，
 * 也不能写死某个赛道的总分。换赛道时这些地方最容易带着旧假设跑偏。
 *
 * 只扫代码，不扫注释：文档里的举例（「显示名，如「语文」」）不该把
 * 共享层整个挡在受检范围外。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 受检的前端文件：共享层 + 纯函数内核。 */
const GUARDED_MODULES = [
  "src/types.ts",
  "src/lib/constants.ts",
  "src/lib/gamification.ts",
];

/** 不允许出现在受检文件里的领域常量。 */
const DOMAIN_TOKENS = [
  "语文",
  "数学",
  "英语",
  "物理",
  "化学",
  "生物",
  "610",
  "750",
];

function readSource(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

/** 去掉注释，只留代码。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//")) return "";
      let quotes = 0;
      let escaped = false;
      for (let index = 0; index < line.length; index += 1) {
        const ch = line[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') quotes += 1;
        if (
          ch === "/" &&
          line[index + 1] === "/" &&
          quotes % 2 === 0
        ) {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join("\n");
}

describe("前端零污染护栏", () => {
  it.each(GUARDED_MODULES)("%s 不该出现领域常量", (relative) => {
    const code = stripComments(readSource(relative));
    for (const token of DOMAIN_TOKENS) {
      expect(
        code.includes(token),
        `${relative} 不该出现领域常量「${token}」。赛道相关内容请放到 \
         lib/track.ts 这类领域适配层里。`,
      ).toBe(false);
    }
  });

  it("护栏不是空转的：领域适配层里确实有学科名", () => {
    const track = readSource("src/lib/track.ts");
    expect(track).toContain("数学");
  });
});
