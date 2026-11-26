import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  {
    label: "src-tauri/Cargo.lock",
    rel: join("src-tauri", "Cargo.lock"),
    bump: bumpCargoLockVersion,
  },
  {
    label: "README.md",
    rel: "README.md",
    bump: bumpReadmeVersion,
  },
];

function main() {
  const version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error("用法: pnpm bump <version>");
    console.error("示例: pnpm bump 4.0.1 / pnpm bump 4.1.0-beta.1");
    console.error("版本必须是 SemVer：主版本号.次版本号.修订号，可带预发布 / 构建元数据");
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
    console.error(`版本未同步到 ${version}`);
    process.exit(1);
  }

  console.log(`同步确认: ${FILES.length} 处均为 ${version}`);
}

export function bumpJsonVersion(text, next, label) {
  const re = /^(\s*"version"\s*:\s*")[^"]+(")/m;
  if (!re.test(text)) {
    throw new Error(`${label}: 找不到顶层 "version" 字段`);
  }
  return text.replace(re, `$1${next}$2`);
}

export function bumpCargoPackageVersion(text, next, label) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  let inPackage = false;
  let replaced = false;
  const out = text.split(/\r?\n/).map((line) => {
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

export function bumpCargoLockVersion(text, next, label) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  let inTarget = false;
  let replaced = false;
  const out = text.split(/\r?\n/).map((line) => {
    if (/^\[\[package\]\]\s*$/.test(line)) {
      inTarget = false;
      return line;
    }
    if (/^name\s*=\s*"timequest"\s*$/.test(line)) {
      inTarget = true;
      return line;
    }
    if (inTarget && !replaced && /^version\s*=\s*"/.test(line)) {
      replaced = true;
      return line.replace(/^(version\s*=\s*")[^"]+(")/, `$1${next}$2`);
    }
    return line;
  });
  if (!replaced) {
    throw new Error(`${label}: 找不到 timequest 包的 version`);
  }
  return out.join(nl);
}

export function bumpReadmeVersion(text, next) {
  const semver = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;
  const rules = [
    [new RegExp(`(当前版本\\s*<strong>)${semver}(</strong>)`), `$1${next}$2`],
    [new RegExp(`(v)${semver}( Release)`), `$1${next}$2`],
    [new RegExp(`(/releases/tag/v)${semver}(?=[)#])`, "g"), `$1${next}`],
    [new RegExp(`(/releases/download/v)${semver}(?=/)`, "g"), `$1${next}`],
    [new RegExp(`(下载 TimeQuest )${semver}(（MSI）)`), `$1${next}$2`],
    [new RegExp(`(TimeQuest_)${semver}(_x64_zh-CN\\.msi)`), `$1${next}$2`],
    [new RegExp(`(下载 TimeQuest )${semver}(（NSIS EXE）)`), `$1${next}$2`],
    [new RegExp(`(TimeQuest_)${semver}(_x64-setup\\.exe)`), `$1${next}$2`],
  ];
  return rules.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

export function readVersion(file, text) {
  if (file.label.endsWith("Cargo.toml")) {
    const match = /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(text);
    return match?.[1] ?? null;
  }
  if (file.label.endsWith("Cargo.lock")) {
    const match = /\[\[package\]\]\s*\r?\nname\s*=\s*"timequest"\s*\r?\nversion\s*=\s*"([^"]+)"/.exec(text);
    return match?.[1] ?? null;
  }
  if (file.label.endsWith("README.md")) {
    const match = /当前版本\s*<strong>([^<]+)<\/strong>/.exec(text);
    return match?.[1] ?? null;
  }
  const match = /"version"\s*:\s*"([^"]+)"/.exec(text);
  return match?.[1] ?? null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
