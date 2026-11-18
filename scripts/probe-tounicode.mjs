// 验证：PDF 带 ToUnicode 映射时，自己查表能不能还原中文。
// 用法: node scripts/probe-tounicode.mjs <pdf 路径或目录>
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

let path = process.argv[2];
if (!path) {
  console.error("用法: node scripts/probe-tounicode.mjs <pdf 路径或目录>");
  process.exit(1);
}
if (statSync(path).isDirectory()) {
  const files = readdirSync(path)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => join(path, name));
  files.sort((a, b) => statSync(b).size - statSync(a).size);
  path = files[0];
}
const buf = readFileSync(path);
const s = buf.toString("latin1");

function inflate(raw) {
  try {
    return inflateSync(raw);
  } catch {
    try {
      return inflateSync(raw, { finishFlush: 2 });
    } catch {
      return null;
    }
  }
}

// ---- 收集所有流对象 ----
const streams = [];
const re = /(\d+)\s+(\d+)\s+obj\s*([\s\S]*?)stream\r?\n/g;
let m;
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
  streams.push({ num, dict, data, text: data.toString("latin1") });
}

// ---- 解析 ToUnicode CMap ----
const map = new Map(); // code(int) -> string
let codeBytes = 2;
for (const st of streams) {
  if (!/begincmap/.test(st.text)) continue;
  const cs = st.text.match(/begincodespacerange([\s\S]*?)endcodespacerange/);
  if (cs) {
    const first = cs[1].match(/<([0-9A-Fa-f]+)>/);
    if (first) codeBytes = Math.max(1, Math.ceil(first[1].length / 2));
  }
  const hexToStr = (hex) => {
    let out = "";
    for (let i = 0; i + 3 < hex.length + 1; i += 4) {
      const unit = hex.slice(i, i + 4);
      if (unit.length < 4) break;
      out += String.fromCharCode(parseInt(unit, 16));
    }
    return out;
  };
  for (const block of st.text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const row of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(row[1], 16), hexToStr(row[2]));
    }
  }
  for (const block of st.text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const row of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(row[1], 16);
      const hi = parseInt(row[2], 16);
      const dst = parseInt(row[3], 16);
      const step = hi - lo;
      if (step < 0 || step > 65535) continue;
      for (let i = 0; i <= step; i += 1) {
        map.set(lo + i, String.fromCharCode(dst + i));
      }
    }
  }
}
console.log("ToUnicode 映射条目:", map.size, "字节宽度:", codeBytes);

// ---- 找内容流里的字符串并解码 ----
function decodeBytes(bytes) {
  let out = "";
  for (let i = 0; i + codeBytes <= bytes.length; i += codeBytes) {
    let code = 0;
    for (let k = 0; k < codeBytes; k += 1) code = (code << 8) | bytes[i + k];
    const hit = map.get(code);
    out += hit ?? "";
  }
  return out;
}

function unescapePdfString(raw) {
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== "\\") {
      out.push(raw.charCodeAt(i) & 0xff);
      continue;
    }
    const next = raw[i + 1];
    i += 1;
    if (next === "n") out.push(10);
    else if (next === "r") out.push(13);
    else if (next === "t") out.push(9);
    else if (next === "b") out.push(8);
    else if (next === "f") out.push(12);
    else if (next === "(") out.push(40);
    else if (next === ")") out.push(41);
    else if (next === "\\") out.push(92);
    else if (next >= "0" && next <= "7") {
      let oct = next;
      while (oct.length < 3 && raw[i + 1] >= "0" && raw[i + 1] <= "7") {
        oct += raw[i + 1];
        i += 1;
      }
      out.push(parseInt(oct, 8) & 0xff);
    } else {
      out.push(next.charCodeAt(0) & 0xff);
    }
  }
  return out;
}

let shown = 0;
for (const st of streams) {
  if (!/BT/.test(st.text)) continue;
  const strings = [...st.text.matchAll(/\(((?:[^()\\]|\\.)*)\)/g)];
  if (strings.length === 0) continue;
  let text = "";
  for (const one of strings) {
    text += decodeBytes(unescapePdfString(one[1]));
  }
  if (text.trim().length === 0) continue;
  shown += 1;
  console.log(`--- 内容流对象 ${st.num} ---`);
  console.log(text.slice(0, 300));
  if (shown >= 6) break;
}
