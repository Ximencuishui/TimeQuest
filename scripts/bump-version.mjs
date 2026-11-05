import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const FILES = [
  {
    label: "package.json",
    rel: "package.json",
    bump: bumpJsonVersion,
  },
  {
    label: "src-tauri/Cargo.toml",
    rel: join("src-tauri", "Cargo.toml"),
    bump: bumpCargoPackageVersion,
  },
  {
    label: "src-tauri/tauri.conf.json",
    rel: join("src-tauri", "tauri.conf.json"),
    bump: bumpJsonVersion,
  },
];

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("用法: pnpm bump <version>");
  console.error("示例: pnpm bump 1.0.1");
  console.error("版本必须是 SemVer：主版本号.次版本号.修订号（如 1.0.0）");
  process.exit(1);
}

const updated = [];
for (const file of FILES) {
  const abs = join(root, file.rel);
  const before = readFileSync(abs, "utf8");
  const after = file.bump(before, version, file.label);
  if (after === before && readVersion(file, before) !== version) {
    console.error(`${file.label}: 未能写入版本号`);
    process.exit(1);
  }
  if (after !== before) writeFileSync(abs, after);
  updated.push({ label: file.label, text: after, bump: file.bump });
}

let synced = true;
console.log("版本已更新:");
for (const file of updated) {
  const current = readVersion(file, file.text);
  const ok = current === version;
  if (!ok) synced = false;
  console.log(`  ${file.label}: ${current ?? "(未读到)"}${ok ? "" : "  ← 与目标不一致"}`);
}

if (!synced) {
  console.error(`三端版本未同步到 ${version}`);
  process.exit(1);
}

console.log(`同步确认: 三端均为 ${version}`);

function bumpJsonVersion(text, next, label) {
  const re = /("version"\s*:\s*")[^"]+(")/;
  if (!re.test(text)) {
    throw new Error(`${label}: 找不到 "version" 字段`);
  }
  return text.replace(re, `$1${next}$2`);
}

function bumpCargoPackageVersion(text, next, label) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  let inPackage = false;
  let replaced = false;
  const out = lines.map((line) => {
    const section = /^\[([^\]]+)\]\s*$/.exec(line);
    if (section) {
      inPackage = section[1] === "package";
      return line;
    }
    if (inPackage && !replaced && /^version\s*=\s*"/.test(line)) {
      replaced = true;
      return line.replace(/^(version\s*=\s*")[^"]+(")/, `$1${next}$2`);
    }
    return line;
  });
  if (!replaced) {
    throw new Error(`${label}: 找不到 [package] version`);
  }
  return out.join(nl);
}

function readVersion(file, text) {
  if (file.label.endsWith("Cargo.toml")) {
    const match = /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(text);
    return match?.[1] ?? null;
  }
  const match = /"version"\s*:\s*"([^"]+)"/.exec(text);
  return match?.[1] ?? null;
}
