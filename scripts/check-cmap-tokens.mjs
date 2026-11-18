// 诊断：ToUnicode CMap 里有没有孤立尖括号（Rust 侧 tokenizer 遇到会死循环）。
// 用法: node scripts/check-cmap-tokens.mjs <pdf 路径或目录>
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

let path = process.argv[2];
if (!path) {
  console.error("用法: node scripts/check-cmap-tokens.mjs <pdf 路径或目录>");
  process.exit(1);
}
if (statSync(path).isDirectory()) {
  const files = readdirSync(path)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => join(path, name));
  files.sort((a, b) => statSync(b).size - statSync(a).size);
  path = files[0];
}
console.log("目标文件:", path);
const buf = readFileSync(path);
const s = buf.toString("latin1");

function inflate(raw) {
  for (const opts of [undefined, { finishFlush: 2 }]) {
    try {
      return inflateSync(raw, opts);
    } catch {
      /* 换一种方式再试 */
    }
  }
  return null;
}

const re = /(\d+)\s+(\d+)\s+obj\s*([\s\S]*?)stream\r?\n/g;
let m;
let cmaps = 0;
let orphanClose = 0;
let totalTokens = 0;
let biggest = 0;
while ((m = re.exec(s)) !== null) {
  const num = Number(m[1]);
  const dict = m[3];
  const start = m.index + m[0].length;
  const endIdx = s.indexOf("endstream", start);
  if (endIdx < 0) continue;
  const raw = buf.subarray(start, endIdx);
  let data = raw;
  if (/\/FlateDecode/.test(dict)) {
    const inflated = inflate(raw);
    if (!inflated) continue;
    data = inflated;
  }
  const text = data.toString("latin1");
  if (!text.includes("begincmap")) continue;
  cmaps += 1;
  biggest = Math.max(biggest, data.length);

  // 扫一遍词法：孤立的 '>' 就是 tokenizer 会卡住的地方。
  let orphan = 0;
  const samples = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "<") {
      const close = text.indexOf(">", i);
      if (close < 0) {
        orphan += 1;
        if (samples.length < 3) samples.push(text.slice(Math.max(0, i - 40), i + 40));
        break;
      }
      i = close;
    } else if (ch === ">") {
      orphan += 1;
      if (samples.length < 3) samples.push(text.slice(Math.max(0, i - 40), i + 40));
    }
  }
  orphanClose += orphan;
  totalTokens += text.length;
  if (orphan > 0 && samples.length > 0) {
    console.log(`对象 ${num}: 孤立 '>' 共 ${orphan} 处`);
    for (const sample of samples) console.log("   片段:", JSON.stringify(sample));
  }
}
console.log("含 begincmap 的流:", cmaps);
console.log("孤立 '>' 总数:", orphanClose);
console.log("CMap 文本总长度:", totalTokens);
console.log("最大 CMap 流字节:", biggest);
