import type { UserProfile } from "../types";

export const SUBJECT_FIELDS = [
  { key: "chinese", label: "语文" },
  { key: "math", label: "数学" },
  { key: "english", label: "英语" },
  { key: "physics", label: "物理" },
  { key: "chemistry", label: "化学" },
  { key: "biology", label: "生物" },
] as const;

export type SubjectKey = (typeof SUBJECT_FIELDS)[number]["key"];

export const GRADES = ["高一", "高二", "高三"] as const;

/** 34 个省级行政区，按民政常用顺序（不是拼音）。 */
export const PROVINCES = [
  "北京",
  "天津",
  "河北",
  "山西",
  "内蒙古",
  "辽宁",
  "吉林",
  "黑龙江",
  "上海",
  "江苏",
  "浙江",
  "安徽",
  "福建",
  "江西",
  "山东",
  "河南",
  "湖北",
  "湖南",
  "广东",
  "广西",
  "海南",
  "重庆",
  "四川",
  "贵州",
  "云南",
  "西藏",
  "陕西",
  "甘肃",
  "青海",
  "宁夏",
  "新疆",
  "香港",
  "澳门",
  "台湾",
] as const;

const PROVINCE_SET = new Set<string>(PROVINCES);

/**
 * 高考六科的满分：语数英各 150，物化生各 100，合计 750。
 *
 * 4.0 起这只是「高考」赛道模板的种子数据——
 * 真正的满分落在 `subjects` 表的 `full_mark` 列上，用户可以自己改。
 */
export const GAOKAO_SUBJECT_FULL_MARKS = {
  chinese: 150,
  math: 150,
  english: 150,
  physics: 100,
  chemistry: 100,
  biology: 100,
};

/**
 * 高考六科的默认目标分。
 *
 * 4.0 起这只是「高考」赛道模板的种子数据，不再是权威来源——
 * 真正的目标落在 `subjects` 表的 `goal` 列上。
 */
export const DEFAULT_SUBJECT_TARGETS = {
  chinese: 120,
  math: 130,
  english: 120,
  physics: 80,
  chemistry: 80,
  biology: 80,
};

export const DEFAULT_USER_PROFILE: UserProfile = {
  avatar: null,
  grade: "高三",
  region: "",
  // 总分目标默认不设：它属于赛道，不同赛道的满分体系不一样。
  total_target: null,
};

/**
 * 引导第 1 步可选的学习方向。
 *
 * 4.0 起高考只是其中一条赛道，不再是产品的形态。其它方向先占位：
 * 选中后按「自定义」处理，等模板真正落地再各自展开。
 *
 * 赛道模板本身住在 `lib/track.ts` —— 那边才是赛道的权威描述。
 */

/** 短名或带省/市/自治区后缀的写法都收成下拉里的那一项。对不上时返回 null。 */
export function canonicalProvince(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (PROVINCE_SET.has(trimmed)) return trimmed;
  const short = shortRegion(trimmed);
  if (PROVINCE_SET.has(short)) return short;
  return null;
}

/** 「湖南省」→「湖南」。已经是短名时保持原样。 */
export function shortRegion(region: string): string {
  const trimmed = region.trim();
  const next = trimmed.replace(
    /(特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/u,
    "",
  );
  return next || trimmed;
}

/** 侧边栏文案，例如「高三 · 湖南」。缺一边时只显示另一边。 */
export function profileLine(grade: string, region: string): string {
  const g = grade.trim();
  const r = shortRegion(region);
  if (g && r) return `${g} · ${r}`;
  return g || r;
}

export function targetHint(sum: number, total: number | null): string {
  if (total == null) return `各科合计 ${sum}，未设总分目标`;
  if (sum === total) return `各科合计 ${sum}，与总分目标一致`;
  const gap = Math.abs(sum - total);
  if (sum > total) return `各科合计 ${sum}，比总分目标多 ${gap} 分`;
  return `各科合计 ${sum}，比总分目标少 ${gap} 分`;
}

export type ProfileDraft = {
  avatar: string | null;
  grade: string;
  region: string;
  totalTarget: string;
};

export function profileToDraft(profile: UserProfile): ProfileDraft {
  return {
    avatar: profile.avatar,
    grade: profile.grade,
    region: profile.region,
    totalTarget: profile.total_target == null ? "" : String(profile.total_target),
  };
}

function parseScore(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

export function parseProfileDraft(
  draft: ProfileDraft,
): { ok: true; profile: UserProfile } | { ok: false; message: string } {
  // 留空 = 不设总分目标（这条赛道按分科计）；填了就得是非负整数。
  const rawTotal = draft.totalTarget.trim();
  const total = rawTotal === "" ? null : parseScore(rawTotal);
  if (rawTotal !== "" && total == null) {
    return { ok: false, message: "总分目标请输入非负整数" };
  }
  const regionRaw = draft.region.trim();
  const region = canonicalProvince(regionRaw);
  if (regionRaw && !region) {
    return { ok: false, message: "请从列表中选择地区" };
  }
  return {
    ok: true,
    profile: {
      avatar: draft.avatar,
      grade: draft.grade.trim(),
      region: region ?? "",
      total_target: total,
    },
  };
}
