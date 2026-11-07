/**
 * One-shot merge of open-source K12 knowledge points onto textbook sections.
 *
 * Reads https://github.com/mmlong818/k12-knowledge-points (PolyForm Noncommercial 1.0.0)
 * and writes `knowledge_points` onto each section in `src-tauri/resources/textbooks`.
 * Sections stay the task unit; unmatched sections get an empty list.
 *
 *   node scripts/merge_knowledge_points.js
 *   node scripts/merge_knowledge_points.js --source path/to/split/高中
 *   node scripts/merge_knowledge_points.js --dry-run
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const textbookDir = path.join(root, "src-tauri", "resources", "textbooks");
const cacheDir = path.join(root, ".cache", "k12-knowledge-points", "split", "高中");
const downloadBases = [
  "https://cdn.jsdelivr.net/gh/mmlong818/k12-knowledge-points@main/split/高中",
  "https://raw.githubusercontent.com/mmlong818/k12-knowledge-points/main/split/高中",
];
const subjects = ["数学", "语文", "英语", "物理", "化学", "生物"];
const minConfidence = 0.5;

const cnDigit = {
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  七: "7",
  八: "8",
  九: "9",
  十: "10",
};
const intCn = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

function parseArgs(argv) {
  const args = { source: cacheDir, dryRun: false, noDownload: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") args.dryRun = true;
    else if (token === "--no-download") args.noDownload = true;
    else if (token === "--source") {
      args.source = path.resolve(argv[i + 1] ?? "");
      i += 1;
    } else if (token === "--help") args.help = true;
  }
  return args;
}

function compact(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[·•．。,，、:：]/g, "")
    .replace(/[—–―\-－]/g, "")
    .replace(/[（）()]/g, "")
    .replace(/与/g, "和")
    .replace(/像/g, "象")
    .replace(/实验/g, "");
}

const genericStems = ["函数", "概念", "应用", "性质", "关系", "方法", "问题", "公式", "运算", "基本", "意义"];

function longestCommon(left, right) {
  let best = "";
  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) {
      let size = 0;
      while (left[i + size] && left[i + size] === right[j + size]) size += 1;
      if (size > best.length) best = left.slice(i, i + size);
    }
  }
  return best;
}

function sharesDistinctStem(ours, theirs) {
  const shared = longestCommon(coreTitle(ours), coreTitle(theirs));
  if (shared.length >= 3) return true;
  return shared.length === 2 && !genericStems.includes(shared);
}

function cnFromInt(value) {
  const num = Number(value);
  if (num >= 0 && num <= 10) return intCn[num];
  if (num > 10 && num < 20) return `十${intCn[num - 10]}`;
  return String(value);
}

function canonHeading(value) {
  return compact(value).replace(/^第(\d+)(章|单元|节|课)/, (_, num, unit) => `第${cnFromInt(num)}${unit}`);
}

function canonVolume(value) {
  return compact(value)
    .replace(/第([一二三四五六七八九十]+)册/g, (_, digits) => cnDigit[digits] ?? digits)
    .replace(/(上|下|中)册/g, "$1")
    .replace(/全一册/g, "全一")
    .replace(/选择性必修/g, "选必");
}

function volumesMatch(ours, theirs) {
  const left = canonVolume(ours);
  const right = canonVolume(theirs);
  if (!left || !right) return false;
  if (left === right) return true;
  return volumeContains(left, right) || volumeContains(right, left);
}

function volumeContains(longer, shorter) {
  if (shorter.length < 3) return false;
  if (longer.startsWith(shorter)) {
    const rest = longer.slice(shorter.length);
    return rest.length === 0 || !/^\d/.test(rest);
  }
  if (longer.endsWith(shorter) && shorter.length >= 4) {
    const rest = longer.slice(0, longer.length - shorter.length);
    return rest.length === 0 || !/\d$/.test(rest);
  }
  return false;
}

function editionMatches(version, title) {
  const book = String(version ?? "");
  const source = String(title ?? "");
  if (book.includes("湘教")) return source.includes("湘教");
  if (book.includes("统编") || book.includes("部编")) {
    return source.includes("统编") || source.includes("部编");
  }
  if (book.includes("人教")) return source.includes("人教");
  const token = book.replace(/版/g, "");
  return token.length > 0 && source.includes(token);
}

function headingsMatch(ours, theirs) {
  const left = canonHeading(ours);
  const right = canonHeading(theirs);
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 4 && longer.startsWith(shorter);
}

function leadingNumber(value) {
  const match = /^(\d+(?:\.\d+)*)/.exec(String(value ?? "").trim());
  return match ? match[1] : "";
}

function coreTitle(value) {
  const stripped = String(value ?? "")
    .trim()
    .replace(/^(?:第\s*)?\d+(?:\.\d+)*\s*\.?\s*/, "")
    .replace(/^第[一二三四五六七八九十\d]+\s*[章节课]\s*/, "");
  return canonHeading(stripped);
}

function looseTitle(value) {
  return coreTitle(value).replace(/和/g, "");
}

export function scoreSection(segment, sectionName) {
  const left = canonHeading(segment);
  const right = canonHeading(sectionName);
  if (!left || !right) return 0;
  if (left === right) return 100;
  const leftNo = leadingNumber(String(segment).trim());
  const rightNo = leadingNumber(String(sectionName).trim());
  const leftTitle = looseTitle(segment);
  const rightTitle = looseTitle(sectionName);
  if (leftNo && rightNo && leftNo === rightNo) {
    const titlesAgree =
      !leftTitle ||
      !rightTitle ||
      leftTitle === rightTitle ||
      leftTitle.includes(rightTitle) ||
      rightTitle.includes(leftTitle);
    return titlesAgree ? 95 : 65;
  }
  if (leftTitle && rightTitle && leftTitle === rightTitle && leftTitle.length >= 2) return 85;
  if (
    leftTitle &&
    rightTitle &&
    leftTitle.length >= 4 &&
    rightTitle.length >= 4 &&
    (leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle))
  ) {
    return 80;
  }
  if (leftNo && rightNo && rightNo.includes(".") && leftNo.startsWith(`${rightNo}.`)) return 70;
  return 0;
}

function chapterOrdinal(value) {
  const match = /^第([一二三四五六七八九十]+)(章|单元)/.exec(canonHeading(value));
  return match ? `${match[1]}${match[2]}` : "";
}

export function chaptersCompatible(ours, theirs) {
  if (headingsMatch(ours, theirs)) return true;
  const left = chapterOrdinal(ours);
  const right = chapterOrdinal(theirs);
  if (!left || left !== right) return false;
  return sharesDistinctStem(ours, theirs);
}

function sectionName(section) {
  return typeof section === "string" ? section : String(section?.name ?? "");
}

function specificity(name) {
  return leadingNumber(name).length;
}

async function pathExists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function resolveSourceDir(source) {
  const candidates = [
    source,
    path.join(source, "高中"),
    path.join(source, "split", "高中"),
  ];
  for (const dir of candidates) {
    if (await pathExists(dir)) {
      const info = await stat(dir);
      if (info.isDirectory()) return dir;
    }
  }
  return source;
}

async function ensureSource(dir) {
  await mkdir(dir, { recursive: true });
  for (const subject of subjects) {
    const file = path.join(dir, `${subject}.json`);
    if (await pathExists(file)) continue;
    let saved = false;
    let lastError = "download failed";
    for (const base of downloadBases) {
      const url = `${base}/${encodeURIComponent(subject)}.json`;
      process.stdout.write(`download ${subject} from ${base}\n`);
      try {
        const response = await fetch(url);
        if (!response.ok) {
          lastError = `${response.status}`;
          continue;
        }
        await writeFile(file, await response.text());
        saved = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (!saved) throw new Error(`download ${subject} failed: ${lastError}`);
  }
}

async function loadPoints(dir) {
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json") && subjects.includes(name.replace(/\.json$/, "")));
  const points = [];
  for (const name of files) {
    let payload;
    try {
      payload = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    } catch (error) {
      process.stderr.write(`skip ${name}: ${error.message}\n`);
      continue;
    }
    const rows = Array.isArray(payload) ? payload : payload.knowledge_points;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) points.push(row);
  }
  return points;
}

function prepareBook(book) {
  return {
    subject: book.subject,
    version: book.version,
    volume: book.volume,
    chapters: book.chapters.map((chapter) => ({
      name: chapter.name,
      sections: chapter.sections.map((section) => ({
        name: sectionName(section),
        knowledge_points: [],
      })),
    })),
  };
}

export function bestSection(book, chapterPath) {
  let best = null;
  for (const chapter of book.chapters) {
    if (!chaptersCompatible(chapter.name, chapterPath[0])) continue;
    for (const section of chapter.sections) {
      for (const segment of chapterPath.slice(1)) {
        const score = scoreSection(segment, section.name);
        if (score < 70) continue;
        const overlap = longestCommon(coreTitle(segment), coreTitle(section.name)).length;
        const spec = specificity(section.name);
        const better =
          !best ||
          score > best.score ||
          (score === best.score && overlap > best.overlap) ||
          (score === best.score && overlap === best.overlap && spec > best.spec);
        if (better) best = { section, score, overlap, spec };
      }
    }
  }
  return best ? best.section : null;
}

function attachAll(books, points) {
  for (const point of points) {
    if (point.grade_band && point.grade_band !== "高中") continue;
    if (typeof point.confidence === "number" && point.confidence < minConfidence) continue;
    const label = String(point.canonical_name ?? point.title ?? "").trim();
    if (!label) continue;
    const subject = point.subject;
    for (const entry of point.textbooks ?? []) {
      const chapterPath = entry.chapter_path ?? [];
      if (chapterPath.length < 2) continue;
      const pool = books.filter(
        (book) => book.subject === subject && editionMatches(book.version, entry.textbook_title),
      );
      const chapterMatched = pool.filter((book) =>
        book.chapters.some((chapter) => chaptersCompatible(chapter.name, chapterPath[0])),
      );
      let targets = chapterMatched.filter((book) => volumesMatch(book.volume, entry.volume));
      if (targets.length === 0) {
        const volumes = new Set(chapterMatched.map((book) => book.volume));
        if (volumes.size === 1) targets = chapterMatched;
      }
      for (const book of targets) {
        const section = bestSection(book, chapterPath);
        if (section && !section.knowledge_points.includes(label)) {
          section.knowledge_points.push(label);
        }
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("node scripts/merge_knowledge_points.js [--source dir] [--dry-run]\n");
    return;
  }
  const sourceDir = await resolveSourceDir(args.source);
  if (!args.noDownload && (sourceDir === cacheDir || !(await pathExists(sourceDir)))) {
    await ensureSource(cacheDir);
  }
  const dir = (await pathExists(sourceDir)) ? sourceDir : cacheDir;
  const points = await loadPoints(dir);
  if (points.length === 0) {
    throw new Error(`no knowledge points under ${dir}`);
  }
  const files = (await readdir(textbookDir)).filter((name) => name.endsWith(".json")).sort();
  const loaded = [];
  for (const file of files) {
    const full = path.join(textbookDir, file);
    loaded.push({ full, book: prepareBook(JSON.parse(await readFile(full, "utf8"))) });
  }
  attachAll(
    loaded.map((item) => item.book),
    points,
  );
  let booksWithPoints = 0;
  let sectionsWithPoints = 0;
  for (const item of loaded) {
    const sections = item.book.chapters.flatMap((chapter) => chapter.sections);
    const matched = sections.filter((section) => section.knowledge_points.length > 0).length;
    const attached = sections.reduce((sum, section) => sum + section.knowledge_points.length, 0);
    if (matched > 0) booksWithPoints += 1;
    sectionsWithPoints += matched;
    const missed = sections.filter((section) => section.knowledge_points.length === 0).map((section) => section.name);
    process.stdout.write(
      `${item.book.subject} ${item.book.version} ${item.book.volume}: ${matched}/${sections.length} sections, ${attached} points\n`,
    );
    if (missed.length > 0 && matched > 0) {
      process.stdout.write(`  unmatched: ${missed.join(" | ")}\n`);
    }
    if (!args.dryRun) {
      await writeFile(item.full, `${JSON.stringify(item.book, null, 2)}\n`);
    }
  }
  process.stdout.write(
    `done: ${booksWithPoints}/${files.length} books, ${sectionsWithPoints} sections with points\n`,
  );
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
