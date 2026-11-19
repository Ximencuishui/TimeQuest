// 从 cn-math-taxonomy 的 GitHub 快照生成知识图谱切片（插件资源）。
//
// 用法：
//   node scripts/build-cn-knowledge-graph.mjs                # 用本地快照生成
//   node scripts/build-cn-knowledge-graph.mjs --refresh      # 先拉最新快照再生成
//
// 上游只发布全量 data/topics.json 和 data/dependencies.json，没有按学科
// 拆分的文件；这里按知识点 id 前缀切片，内置数学与物理，其余学科写进
// packs.json，等用户点下载时再取。
//
// 快照放在 .cache/ 下（不入库），切片产物入库并随插件内置。
// 上游许可：CC BY-NC 4.0（署名-非商业性使用）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(root, ".cache", "cn-math-taxonomy");
const OUT_DIR = join(
  root,
  "src-tauri",
  "resources",
  "plugins",
  "cn-knowledge-graph",
);

const SOURCE_REPO = "xiaoyang111222/cn-math-taxonomy";
const SOURCE_URL = `https://github.com/${SOURCE_REPO}`;
const RAW_BASE_URL = `https://raw.githubusercontent.com/${SOURCE_REPO}`;
const LICENSE = "CC BY-NC 4.0";
const LICENSE_URL = "https://creativecommons.org/licenses/by-nc/4.0/";

/**
 * 随包内置的学科：id 前缀 → 学科名。
 *
 * expect 是上游 README 里各学段统计表的合计数。切片点数对不上就中止，
 * 宁可停下报错，也不要把切错的数据内置进应用。
 */
const BUILTIN_PACKS = [
  { subject: "math", name: "数学", prefix: "cnm_", expect: 870 },
  { subject: "physics", name: "物理", prefix: "cnp_", expect: 269 },
];

/**
 * 其余学科的 id 前缀，用于在 packs.json 里点名，让用户知道能下什么。
 *
 * 上游新增学科时这里会空缺：脚本把没认出来的前缀归到「其他学科」包，
 * 不漏数据，也不猜错学科。
 */
const KNOWN_PREFIXES = [
  { subject: "english", name: "英语", prefix: "cne_" },
  { subject: "chinese", name: "语文", prefix: "cnc_" },
  { subject: "science", name: "科学", prefix: "cns_" },
  { subject: "morality", name: "道德与法治", prefix: "cnd_" },
];

/**
 * 上游两个数据文件。sha 锁内容，拿到的是同一份文件。
 *
 * 重新生成时用 --refresh 更新 sha：先问 GitHub 要这两个文件的 blob sha，
 * 拉新内容，再把新 sha 写回本文件。
 */
const SOURCE_FILES = {
  topics: {
    path: "data/topics.json",
    sha: "4a5d7eb084bc85a90556f637381d768ec859a4f7",
    size: 3361855,
  },
  dependencies: {
    path: "data/dependencies.json",
    sha: "7aab6f220b0bc19f25c9bf436852b721a6a485c2",
    size: 1022780,
  },
};

const refresh = process.argv.includes("--refresh");

if (refresh || !existsSync(join(CACHE_DIR, "topics.json"))) {
  await fetchAll();
}

const topics = JSON.parse(readFileSync(join(CACHE_DIR, "topics.json"), "utf8"));
const dependencies = JSON.parse(
  readFileSync(join(CACHE_DIR, "dependencies.json"), "utf8"),
);

if (!Array.isArray(topics) || !Array.isArray(dependencies)) {
  console.error("快照格式不对（顶层要是数组），生成中止");
  process.exit(1);
}

const commit = await resolveCommit();
const generatedAt = new Date().toISOString().slice(0, 10);

// 按前缀分组。
const groups = new Map();
for (const topic of topics) {
  const prefix = topicPrefix(topic.id);
  if (!prefix) continue;
  if (!groups.has(prefix)) groups.set(prefix, []);
  groups.get(prefix).push(topic);
}

const builtin = [];
for (const pack of BUILTIN_PACKS) {
  const picked = groups.get(pack.prefix) ?? [];
  if (picked.length !== pack.expect) {
    console.error(
      `内置包 ${pack.name}（${pack.prefix}）期望 ${pack.expect} 个知识点，` +
        `实际切出 ${picked.length} 个。生成中止。`,
    );
    process.exit(1);
  }
  builtin.push({ ...pack, topics: picked });
}

// 其余学科：已知的按名字点名，没认出来的归到「其他学科」。
const builtinPrefixes = new Set(BUILTIN_PACKS.map((pack) => pack.prefix));
const downloadable = [];
for (const known of KNOWN_PREFIXES) {
  if (builtinPrefixes.has(known.prefix)) continue;
  const picked = groups.get(known.prefix) ?? [];
  if (picked.length === 0) continue;
  downloadable.push({
    subject: known.subject,
    name: known.name,
    prefix: known.prefix,
    count: picked.length,
  });
}

const otherPrefixes = [...groups.keys()].filter(
  (prefix) =>
    !builtinPrefixes.has(prefix) &&
    !KNOWN_PREFIXES.some((known) => known.prefix === prefix),
);
if (otherPrefixes.length > 0) {
  const count = otherPrefixes.reduce(
    (sum, prefix) => sum + groups.get(prefix).length,
    0,
  );
  downloadable.push({
    subject: "other",
    name: "其他学科",
    prefix: otherPrefixes.join(","),
    count,
  });
}

mkdirSync(OUT_DIR, { recursive: true });

for (const pack of builtin) {
  const packTopics = pack.topics.map(toTopic);
  const ids = new Set(packTopics.map((topic) => topic.id));
  const packEdges = dependencies
    .filter((edge) => ids.has(edge.topicId) && ids.has(edge.prerequisiteId))
    .map((edge) => ({
      topicId: edge.topicId,
      prerequisiteId: edge.prerequisiteId,
      strength: edge.strength ?? "soft",
      reason: edge.reason ?? "",
    }));

  writeJson(join(OUT_DIR, `topics.${pack.subject}.json`), {
    schema: 1,
    subject: pack.subject,
    subjectName: pack.name,
    source: SOURCE_URL,
    license: LICENSE,
    generatedAt,
    commit,
    count: packTopics.length,
    topics: packTopics,
  });

  writeJson(join(OUT_DIR, `dependencies.${pack.subject}.json`), {
    schema: 1,
    subject: pack.subject,
    subjectName: pack.name,
    source: SOURCE_URL,
    license: LICENSE,
    generatedAt,
    commit,
    count: packEdges.length,
    dependencies: packEdges,
  });

  console.log(
    `内置 ${pack.name}：${packTopics.length} 个知识点，${packEdges.length} 条先修边`,
  );
}

writeJson(join(OUT_DIR, "packs.json"), {
  schema: 1,
  source: SOURCE_URL,
  repo: SOURCE_REPO,
  rawBase: RAW_BASE_URL,
  commit,
  license: LICENSE,
  licenseUrl: LICENSE_URL,
  generatedAt,
  files: SOURCE_FILES,
  builtin: BUILTIN_PACKS.map((pack) => ({
    subject: pack.subject,
    name: pack.name,
    prefix: pack.prefix,
    count: pack.expect,
  })),
  downloadable,
});

console.log(`学科包清单已生成: ${join(OUT_DIR, "packs.json")}`);
for (const pack of downloadable) {
  console.log(`  可下载：${pack.name}（${pack.prefix}）${pack.count} 个`);
}

/** 知识点 id 的学科前缀：取下划线前那段，例如 cnm_p001 → cnm_。 */
function topicPrefix(id) {
  const text = String(id ?? "");
  const at = text.indexOf("_");
  if (at <= 0) return "";
  return `${text.slice(0, at)}_`;
}

/** 上游节点 → 我们用的精简结构。 */
function toTopic(topic) {
  return {
    id: topic.id,
    name: topic.name ?? "",
    domain: topic.domain ?? "",
    grade: typeof topic.grade === "number" ? topic.grade : 0,
    stage: stageOf(topic.grade),
    semester: topic.semester ?? "",
    chapter: topic.chapter ?? "",
    type: topic.type ?? "",
    description: topic.description ?? "",
    masteryCriteria: Array.isArray(topic.mastery_criteria)
      ? topic.mastery_criteria
      : [],
    diagnosticQuestion: topic.diagnostic_question ?? null,
    mathLinks: Array.isArray(topic.mathLinks) ? topic.mathLinks : [],
  };
}

/** 按年级推学段：1–6 小学，7–9 初中，10 及以上高中。 */
function stageOf(grade) {
  if (typeof grade !== "number") return "其他";
  if (grade >= 1 && grade <= 6) return "小学";
  if (grade >= 7 && grade <= 9) return "初中";
  if (grade >= 10) return "高中";
  return "其他";
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** 当前 main 分支的提交号。拿不到就留空：下载时只用 blob 通道也走得通。 */
async function resolveCommit() {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${SOURCE_REPO}/commits/main`,
      { headers: { "User-Agent": "TimeQuest" } },
    );
    if (!response.ok) return "";
    const data = await response.json();
    return data.sha ?? "";
  } catch {
    return "";
  }
}

/** 拉全量快照。走 blob 接口，地址里只有 sha，不受中文路径影响。 */
async function fetchAll() {
  mkdirSync(CACHE_DIR, { recursive: true });
  for (const [key, file] of Object.entries(SOURCE_FILES)) {
    const target = join(CACHE_DIR, `${key}.json`);
    if (existsSync(target) && !refresh) continue;
    const response = await fetch(
      `https://api.github.com/repos/${SOURCE_REPO}/git/blobs/${file.sha}`,
      {
        headers: {
          "User-Agent": "TimeQuest",
          Accept: "application/vnd.github.raw",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`拉取 ${file.path} 失败: ${response.status}`);
    }
    const text = await response.text();
    JSON.parse(text); // 顺手验一下是不是完整 JSON
    writeFileSync(target, text, "utf8");
    console.log(`快照已更新: ${target}`);
  }
}
