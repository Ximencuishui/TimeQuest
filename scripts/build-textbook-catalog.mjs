// 从 ChinaTextbook 的 Git 树快照生成教材清单（插件资源）。
//
// 用法：
//   node scripts/build-textbook-catalog.mjs                # 用本地快照生成
//   node scripts/build-textbook-catalog.mjs --refresh      # 先拉最新树再生成
//
// 树快照来自 api.github.com 的 git/trees 接口，放在 .cache/ 下（不入库）。
// 生成的 catalog.json 随插件内置：用户浏览教材库不需要联网，
// 只有真正下载某本书时才去 raw.githubusercontent 取文件。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TREE_PATH = join(root, ".cache", "china-textbook", "tree.json");
const OUT_PATH = join(
  root,
  "src-tauri",
  "resources",
  "plugins",
  "china-textbook",
  "catalog.json",
);

const SOURCE_REPO = "TapXWorld/ChinaTextbook";
const SOURCE_URL = `https://github.com/${SOURCE_REPO}`;
/** 下载用的原始文件地址前缀，具体文件路径由清单里的 path 拼上去。 */
const RAW_BASE_URL = `https://raw.githubusercontent.com/${SOURCE_REPO}`;

/** 不是教材的目录：中考试卷合集，不进教材库。 */
const EXCLUDED_ROOTS = ["学数学最重要的刷习题在这里"];

/** 学段归一化：五•四学制并回主学段，杂项进「其他」。 */
const STAGE_ALIASES = {
  小学: "小学",
  "小学（五•四学制）": "小学",
  初中: "初中",
  "初中（五•四学制）": "初中",
  高中: "高中",
  大学: "大学",
};

const refresh = process.argv.includes("--refresh");

if (refresh || !existsSync(TREE_PATH)) {
  await fetchTree();
}

const snapshot = JSON.parse(readFileSync(TREE_PATH, "utf8"));
const textbooks = collectTextbooks(snapshot.tree);

if (textbooks.length === 0) {
  console.error("树快照里没有教材，生成中止");
  process.exit(1);
}

const stages = tally(textbooks.map((book) => book.stageKey));
const catalog = {
  schema: 1,
  source: SOURCE_URL,
  repo: SOURCE_REPO,
  rawBase: RAW_BASE_URL,
  commit: snapshot.sha ?? "",
  generatedAt: new Date().toISOString().slice(0, 10),
  count: textbooks.length,
  stages,
  textbooks,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

console.log(`教材清单已生成: ${OUT_PATH}`);
console.log(`  条目 ${catalog.count} 本，${stages.length} 个学段`);
for (const stage of stages) {
  console.log(`  ${stage.label}: ${stage.count}`);
}

async function fetchTree() {
  const info = await fetch(`https://api.github.com/repos/${SOURCE_REPO}/git/trees/HEAD?recursive=1`, {
    headers: { "User-Agent": "TimeQuest" },
  });
  if (!info.ok) throw new Error(`拉取目录树失败: ${info.status}`);
  const data = await info.json();
  if (data.truncated) {
    console.error("目录树被 GitHub 截断，教材清单会不完整");
  }
  mkdirSync(dirname(TREE_PATH), { recursive: true });
  writeFileSync(TREE_PATH, JSON.stringify(data), "utf8");
  console.log(`树快照已更新: ${TREE_PATH}`);
}

/**
 * 把 Git 树条目整理成教材清单。
 *
 * 普通教材是 `学段/科目/版本/年级/书名.pdf`；超过 GitHub 单文件 100MB 上限的
 * 会被仓库切成 `<书名>.pdf_merge_folder/<书名>.pdf.N`，这里把它们归回同一本书，
 * 用 `parts` 记分片数，下载时按顺序拼起来。
 *
 * 每个分片都记下自己的 blob sha：下载走 GitHub 的 blob 接口时，
 * 地址里只需要 sha，不用拼中文路径。
 *
 * 有些书仓库里两种形式都有（完整 PDF 和分片各一份），这种情况取完整的那份。
 */
function collectTextbooks(tree) {
  const plain = new Map();
  const shards = new Map();

  for (const entry of tree) {
    if (entry.type !== "blob") continue;
    const path = entry.path;
    if (!path.toLowerCase().endsWith(".pdf") && !path.includes(".pdf_merge_folder/")) continue;
    if (EXCLUDED_ROOTS.some((excluded) => path.startsWith(`${excluded}/`))) continue;

    const mergeAt = path.indexOf(".pdf_merge_folder/");
    if (mergeAt >= 0) {
      const bookPath = path.slice(0, mergeAt + ".pdf".length);
      const partNo = Number(path.slice(path.lastIndexOf(".") + 1));
      if (!Number.isFinite(partNo)) continue;
      const list = shards.get(bookPath) ?? [];
      list.push({ index: partNo, size: entry.size ?? 0, sha: entry.sha ?? "" });
      shards.set(bookPath, list);
      continue;
    }

    if (!path.toLowerCase().endsWith(".pdf")) continue;
    plain.set(path, { size: entry.size ?? 0, sha: entry.sha ?? "" });
  }

  const list = [];
  for (const [path, file] of plain) {
    list.push(toEntry(path, file.size, [makeShard(1, file.size, file.sha)]));
  }
  for (const [path, parts] of shards) {
    if (plain.has(path)) continue;
    const size = parts.reduce((sum, part) => sum + part.size, 0);
    list.push(
      toEntry(
        path,
        size,
        parts
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((part) => makeShard(part.index, part.size, part.sha)),
      ),
    );
  }

  list.sort(
    (a, b) =>
      a.stageKey.localeCompare(b.stageKey, "zh-Hans-CN") ||
      a.subject.localeCompare(b.subject, "zh-Hans-CN") ||
      (a.grade ?? "").localeCompare(b.grade ?? "", "zh-Hans-CN") ||
      (a.edition ?? "").localeCompare(b.edition ?? "", "zh-Hans-CN") ||
      a.title.localeCompare(b.title, "zh-Hans-CN"),
  );
  return list;
}

function makeShard(index, size, sha) {
  return { index, size, sha };
}

function toEntry(path, size, shards) {
  const dims = splitPath(path);
  return {
    path,
    title: dims.title,
    stage: dims.stage,
    stageKey: STAGE_ALIASES[dims.stage] ?? "其他",
    subject: dims.subject,
    edition: dims.edition,
    grade: dims.grade,
    size,
    parts: shards.length,
    shards,
  };
}

/**
 * 目录树里的教材路径是 `学段/科目/版本/年级/书名.pdf`，但深度不固定：
 * 有的没有年级，有的一层就到底。按尾部对齐来拆，拆不出的维度留空。
 */
function splitPath(path) {
  const segments = path.split("/").filter(Boolean);
  const fileName = segments.pop() ?? "";
  const title = fileName.replace(/\.pdf$/i, "");
  const stage = segments[0] ?? "";
  const subject = segments[1] ?? "";
  const rest = segments.slice(2);
  const edition = rest.length === 1 ? rest[0] : rest.length >= 2 ? rest[rest.length - 2] : null;
  const grade = rest.length >= 2 ? rest[rest.length - 1] : null;
  return { stage, subject, edition, grade, title };
}

function tally(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-Hans-CN"));
}
