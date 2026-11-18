// 诊断 PDF 的字体编码：把 ToUnicode CMap 解压出来看看映射到的是什么字符。
// 用法: node scripts/inspect-pdf-encoding.mjs <pdf 路径或目录>
// 传目录时取里面最大的那个 PDF（命令行传中文路径容易被终端编码坑）。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

let path = process.argv[2];
if (!path) {
  console.error("用法: node scripts/inspect-pdf-encoding.mjs <pdf 路径或目录>");
  process.exit(1);
}
if (statSync(path).isDirectory()) {
  const files = readdirSync(path)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => join(path, name));
  if (files.length === 0) {
    console.error("目录里没有 PDF");
    process.exit(1);
  }
  files.sort((a, b) => statSync(b).size - statSync(a).size);
  path = files[0];
}
const buf = readFileSync(path);
const s = buf.toString("latin1");

const objects = [];
const re = /(\d+)\s+(\d+)\s+obj\b/g;
let m;
while ((m = re.exec(s)) !== null) {
  objects.push({ num: Number(m[1]), start: m.index });
}
// 对象字典到下一个 obj 之间的内容
function objectBody(num) {
  const o = objects.find((x) => x.num === num);
  if (!o) return null;
  const next = objects.find((x) => x.start > o.start);
  const end = next ? next.start : s.length;
  return s.slice(o.start, end);
}

function streams() {
  const out = [];
  const re2 = /(\d+)\s+(\d+)\s+obj\s*([\s\S]*?)stream\r?\n/g;
  let mm;
  while ((mm = re2.exec(s)) !== null) {
    const dict = mm[3];
    const num = Number(mm[1]);
    const start = mm.index + mm[0].length;
    const endIdx = s.indexOf("endstream", start);
    if (endIdx < 0) continue;
    const raw = buf.subarray(start, endIdx);
    let data = raw;
    if (/\/FlateDecode/.test(dict)) {
      try {
        data = inflateSync(raw);
      } catch {
        try {
          data = inflateSync(raw, { finishFlush: 2 });
        } catch {
          continue;
        }
      }
    }
    out.push({ num, dict, data });
  }
  return out;
}

const all = streams();
console.log("文件:", path, buf.length, "字节");
console.log("带流的对象:", all.length);

const cmaps = all.filter((x) => /beginbfchar|beginbfrange|begincmap/.test(x.data.toString("latin1")));
console.log("ToUnicode / CMap 流:", cmaps.length);

for (const c of cmaps.slice(0, 2)) {
  const text = c.data.toString("utf8");
  console.log("---- 对象", c.num, "解码后", text.length, "字符 ----");
  console.log(text.slice(0, 600));
}

// 顺便看字体字典
const fontObjs = objects.filter((o) => {
  const body = objectBody(o.num) ?? "";
  return /\/Type\s*\/Font/.test(body);
});
console.log("字体对象:", fontObjs.length);
for (const f of fontObjs.slice(0, 3)) {
  const body = objectBody(f.num) ?? "";
  console.log("---- 字体对象", f.num, "----");
  console.log(body.slice(0, 400).replace(/\s+/g, " "));
}
