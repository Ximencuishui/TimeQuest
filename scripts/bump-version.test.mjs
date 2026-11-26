import assert from "node:assert/strict";
import test from "node:test";
import {
  bumpCargoLockVersion,
  bumpCargoPackageVersion,
  bumpJsonVersion,
  bumpReadmeVersion,
  readVersion,
} from "./bump-version.mjs";

test("JSON 顶层 version 只替换第一处", () => {
  const before = '{\n  "version": "4.0.0",\n  "nested": { "version": "keep" }\n}';
  const after = bumpJsonVersion(before, "4.0.1", "package.json");
  assert.equal(readVersion({ label: "package.json" }, after), "4.0.1");
  assert.match(after, /"nested": \{ "version": "keep" \}/);
});

test("Cargo.toml 只替换 [package] 下的 version", () => {
  const before = '[package]\nname = "timequest"\nversion = "4.0.0"\n\n[dependencies]\nfoo = "1.0.0"';
  const after = bumpCargoPackageVersion(before, "4.1.0-beta.1", "Cargo.toml");
  assert.equal(readVersion({ label: "Cargo.toml" }, after), "4.1.0-beta.1");
  assert.match(after, /foo = "1\.0\.0"/);
});

test("Cargo.lock 只替换 timequest 自身的 version", () => {
  const before = [
    "[[package]]",
    'name = "other"',
    'version = "9.9.9"',
    "",
    "[[package]]",
    'name = "timequest"',
    'version = "4.0.0"',
    "",
  ].join("\n");
  const after = bumpCargoLockVersion(before, "4.0.2", "Cargo.lock");
  assert.equal(readVersion({ label: "Cargo.lock" }, after), "4.0.2");
  assert.match(after, /name = "other"\nversion = "9\.9\.9"/);
});

test("README 同步版本号、Release 标签与两种安装包链接", () => {
  const before = [
    "当前版本 <strong>4.0.0</strong>",
    "[v4.0.0 Release](https://github.com/example/timequest/releases/tag/v4.0.0)",
    "**[下载 TimeQuest 4.0.0（MSI）](https://github.com/example/timequest/releases/download/v4.0.0/TimeQuest_4.0.0_x64_zh-CN.msi)**",
    "**[下载 TimeQuest 4.0.0（NSIS EXE）](https://github.com/example/timequest/releases/download/v4.0.0/TimeQuest_4.0.0_x64-setup.exe)**",
  ].join("\n");
  const after = bumpReadmeVersion(before, "4.2.0");
  assert.equal(readVersion({ label: "README.md" }, after), "4.2.0");
  assert.match(after, /v4\.2\.0 Release/);
  assert.match(after, /releases\/tag\/v4\.2\.0/);
  assert.match(after, /releases\/download\/v4\.2\.0\/TimeQuest_4\.2\.0_x64_zh-CN\.msi/);
  assert.match(after, /releases\/download\/v4\.2\.0\/TimeQuest_4\.2\.0_x64-setup\.exe/);
  assert.match(after, /TimeQuest_4\.2\.0_x64_zh-CN\.msi/);
  assert.match(after, /TimeQuest_4\.2\.0_x64-setup\.exe/);
});
