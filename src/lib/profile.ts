import type { SubjectTargets, UserProfile } from "../types";

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

/** 语文 120 + 数学 130 + 英语 120 + 理化生各 80。 */
export const DEFAULT_SUBJECT_TARGETS: SubjectTargets = {
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
  total_target: 610,
  subject_targets: { ...DEFAULT_SUBJECT_TARGETS },
};

/**
 * 引导第 1 步可选的学习方向。
 *
 * 4.0 起高考只是其中一条赛道，不再是产品的形态。其它方向先占位：
 * 选中后按「自定义」处理，等模板真正落地再各自展开。
 */
export type TrackTemplateId = "gaokao" | "kaoyan" | "language" | "skill" | "custom";

export type TrackTemplate = {
  id: TrackTemplateId;
  /** 卡片标题。 */
  name: string;
  /** 卡片副标题：一句话说清这条赛道要什么。 */
  tagline: string;
  /** 是否已经落地。false = 占位，选中后走「自定义」分支。 */
  available: boolean;
  /** 默认目标名称。 */
  goalName: string;
  /** 科目清单。没有科目的赛道不计总分。 */
  subjects: { key: SubjectKey; label: string; goal: number }[];
  /** 总分满分。0 表示这条赛道不计总分。 */
  maxScore: number;
  /** 是否需要年级 / 地区这类上下文（高考需要）。 */
  requiresGaokaoContext: boolean;
};

/** 高考的六科：科目清单即目标分清单。 */
const GAOKAO_SUBJECTS = SUBJECT_FIELDS.map((field) => ({
  key: field.key,
  label: field.label,
  goal: DEFAULT_SUBJECT_TARGETS[field.key],
}));

export const TRACK_TEMPLATES: TrackTemplate[] = [
  {
    id: "gaokao",
    name: "高考",
    tagline: "按年级计天数到考试日，六科既有满分也有目标分。",
    available: true,
    goalName: "高考",
    subjects: GAOKAO_SUBJECTS,
    maxScore: 750,
    requiresGaokaoContext: true,
  },
  {
    id: "kaoyan",
    name: "考研",
    tagline: "初试到复试的长线倒计时，分数制。",
    available: false,
    goalName: "考研",
    subjects: [],
    maxScore: 500,
    requiresGaokaoContext: false,
  },
  {
    id: "language",
    name: "语言学习",
    tagline: "零基础、托福或日常用语，按考试日计时。",
    available: false,
    goalName: "语言学习",
    subjects: [],
    maxScore: 100,
    requiresGaokaoContext: false,
  },
  {
    id: "skill",
    name: "技能习得",
    tagline: "编程、乐器、健身这类以周为单位的目标。",
    available: false,
    goalName: "技能习得",
    subjects: [],
    maxScore: 0,
    requiresGaokaoContext: false,
  },
  {
    id: "custom",
    name: "自定义",
    tagline: "自己起名字，定个日期，想考几分填几分。",
    available: true,
    goalName: "我的目标",
    subjects: [],
    maxScore: 0,
    requiresGaokaoContext: false,
  },
];

/** 取一条赛道模板；认不出来时回落到最后一条（自定义）。 */
export function trackTemplateById(id: TrackTemplateId): TrackTemplate {
  return (
    TRACK_TEMPLATES.find((template) => template.id === id) ??
    (TRACK_TEMPLATES[TRACK_TEMPLATES.length - 1] as TrackTemplate)
  );
}

export function subjectTargetSum(targets: SubjectTargets): number {
  return SUBJECT_FIELDS.reduce((sum, field) => sum + targets[field.key], 0);
}

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

export function targetHint(sum: number, total: number): string {
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
  subjects: Record<SubjectKey, string>;
};

export function profileToDraft(profile: UserProfile): ProfileDraft {
  const subjects = {} as Record<SubjectKey, string>;
  for (const field of SUBJECT_FIELDS) {
    subjects[field.key] = String(profile.subject_targets[field.key]);
  }
  return {
    avatar: profile.avatar,
    grade: profile.grade,
    region: profile.region,
    totalTarget: String(profile.total_target),
    subjects,
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
  const total = parseScore(draft.totalTarget.trim());
  if (total == null) {
    return { ok: false, message: "总分目标请输入非负整数" };
  }
  const subjects = {} as SubjectTargets;
  for (const field of SUBJECT_FIELDS) {
    const score = parseScore(draft.subjects[field.key].trim());
    if (score == null) {
      return { ok: false, message: `${field.label}目标请输入非负整数` };
    }
    subjects[field.key] = score;
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
      subject_targets: subjects,
    },
  };
}
