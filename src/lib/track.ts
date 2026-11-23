import type { DateRule, Goal, PluginInfo, Subject, Track } from "../types";
import { DEFAULT_SUBJECT_TARGETS, SUBJECT_FIELDS } from "./profile";
import { GAOKAO_DATE_RULE, resolveDateRule } from "./examDate";

export { subjectsByKey } from "./subjects";

/**
 * 赛道模板。
 *
 * 4.0 起「高考」只是其中一条赛道，不再是产品唯一的形态。
 * 模板描述一条赛道长什么样：叫什么、满分多少、有哪些科目、要不要年级/地区。
 *
 * 内置模板是「配置缺失时的兜底」；P2-1 之后赛道包（插件）会覆盖它们。
 */
export type TrackTemplateId =
  | "gaokao"
  | "kaoyan"
  | "language"
  | "skill"
  | "custom";

/** 模板里的一科。 */
export type TrackSubjectTemplate = {
  /**
   * 科目标识。全库唯一，所以不同赛道的科目不能重名——
   * 这里给每条赛道加了前缀（`kaoyan_`、`lang_`……）。
   */
  key: string;
  label: string;
  /** 该科满分。 */
  fullMark: number;
  /** 该科默认目标分。 */
  goal: number;
  /** 单位。默认「分」。 */
  unit?: string;
};

export type TrackTemplate = {
  id: TrackTemplateId;
  /** 卡片标题。 */
  name: string;
  /** 卡片副标题：一句话说清这条赛道要追什么。 */
  tagline: string;
  /** 是否已经落地。false 表示占位，选中后走「自定义」分支。 */
  available: boolean;
  /** 默认目标名称。 */
  goalName: string;
  /** 科目清单。没有科目就是纯倒计时赛道。 */
  subjects: TrackSubjectTemplate[];
  /** 总分满分。0 表示这条赛道不计总分。 */
  maxScore: number;
  /** 是否需要年级 / 地区这类上下文（高考需要）。 */
  requiresGaokaoContext: boolean;
  /** 赛道类型，对应 `tracks.kind`。 */
  kind: "exam" | "skill" | "course";
  /**
   * 目标日期规则。
   *
   * 内置模板里是一份兜底；装了对应的赛道包之后，规则以包里的为准。
   */
  dateRule?: DateRule;
};

/** 高考的六科：科目清单沿用档案里的默认目标。 */
const GAOKAO_SUBJECTS: TrackSubjectTemplate[] = SUBJECT_FIELDS.map((field) => ({
  key: field.key,
  label: field.label,
  fullMark: DEFAULT_SUBJECT_TARGETS[field.key],
  goal: DEFAULT_SUBJECT_TARGETS[field.key],
  unit: "分",
}));

/**
 * 内置赛道模板。
 *
 * 它们是「没装赛道包时的兜底」：装了 `track-gaokao` 这类赛道包之后，
 * 包里的科目与日期规则才是权威来源。
 */
export const TRACK_TEMPLATES: TrackTemplate[] = [
  {
    id: "gaokao",
    name: "高考",
    tagline: "按年级倒计时到考试日，六科都有满分和目标分。",
    available: true,
    goalName: "高考",
    subjects: GAOKAO_SUBJECTS,
    maxScore: 750,
    requiresGaokaoContext: true,
    kind: "exam",
    dateRule: GAOKAO_DATE_RULE,
  },
  {
    id: "kaoyan",
    name: "考研",
    tagline: "初试到复试的长线倒计时，分数制。",
    available: true,
    goalName: "考研",
    subjects: [
      { key: "kaoyan_politics", label: "政治", fullMark: 100, goal: 70, unit: "分" },
      { key: "kaoyan_english", label: "英语", fullMark: 100, goal: 70, unit: "分" },
      { key: "kaoyan_math", label: "数学", fullMark: 150, goal: 100, unit: "分" },
    ],
    maxScore: 500,
    requiresGaokaoContext: false,
    kind: "exam",
  },
  {
    id: "language",
    name: "语言学习",
    tagline: "雅思、托福或者日常语言，按考试日倒计时。",
    available: true,
    goalName: "语言学习",
    subjects: [
      { key: "lang_listening", label: "听力", fullMark: 30, goal: 24, unit: "分" },
      { key: "lang_reading", label: "阅读", fullMark: 40, goal: 32, unit: "分" },
      { key: "lang_writing", label: "写作", fullMark: 30, goal: 24, unit: "分" },
    ],
    maxScore: 100,
    requiresGaokaoContext: false,
    kind: "exam",
  },
  {
    id: "skill",
    name: "技能习得",
    tagline: "编程、乐器、健身这类以周为单位的目标。",
    available: true,
    goalName: "技能习得",
    subjects: [
      { key: "skill_theory", label: "理论", fullMark: 100, goal: 80, unit: "分" },
      { key: "skill_practice", label: "实操", fullMark: 100, goal: 80, unit: "分" },
    ],
    maxScore: 0,
    requiresGaokaoContext: false,
    kind: "skill",
  },
  {
    id: "custom",
    name: "自定义",
    tagline: "自己起个名字，定个日期，想追分就填科目。",
    available: true,
    goalName: "我的目标",
    subjects: [],
    maxScore: 0,
    requiresGaokaoContext: false,
    kind: "exam",
  },
];

/** 取一条赛道模板；认不出来时回落到最后一条（自定义）。 */
export function trackTemplateById(id: TrackTemplateId): TrackTemplate {
  return (
    TRACK_TEMPLATES.find((template) => template.id === id) ??
    (TRACK_TEMPLATES[TRACK_TEMPLATES.length - 1] as TrackTemplate)
  );
}

/**
 * 这条赛道要不要问年级。
 *
 * 高考要问（目标日期按年级推算）；别的赛道只要规则里带了年级偏移
 * 才需要问。赛道包提供的规则也算数 —— 只看模板会漏掉包里的年级偏移。
 */
export function templateNeedsGrade(
  template: TrackTemplate,
  packages: PluginInfo[] = [],
): boolean {
  const rule = template.dateRule ?? dateRuleFromPackages(packages, template.name);
  return template.requiresGaokaoContext || Boolean(rule?.grade_offsets);
}

/**
 * 模板的目标日期。
 *
 * 规则优先用赛道包提供的，没有就用模板自带的。
 */
export function resolveTemplateDate(
  template: TrackTemplate,
  rule: DateRule | null,
  grade?: string | null,
  now: Date = new Date(),
): string {
  const effective = rule ?? template.dateRule;
  if (!effective) return "";
  return resolveDateRule(effective, grade, now);
}

/**
 * 从插件清单里找赛道包提供的日期规则。
 *
 * 赛道包是规则的权威来源：包里的 `date_rule` 说了算，
 * 内置模板只是没装包时的兜底。
 */
export function dateRuleFromPackages(
  packages: PluginInfo[],
  trackName: string,
): DateRule | null {
  for (const plugin of packages) {
    if (plugin.kind !== "track") continue;
    const provides = plugin.provides;
    if (!provides) continue;
    const name = provides.track?.name;
    if (name && name !== trackName) continue;
    const rule = provides.goals?.find((goal) => goal.date_rule)?.date_rule;
    if (rule) return rule;
  }
  return null;
}

/**
 * 一条赛道的日期规则。
 *
 * 赛道包优先（包里的 date_rule 是权威来源），没有包就用同名内置模板的兜底。
 * 找不到规则返回 null —— 调用方要保留用户已有的日期，
 * 不能拿别的赛道的规则盖上去。
 */
export function dateRuleForTrack(
  trackName: string | null | undefined,
  packages: PluginInfo[] = [],
): DateRule | null {
  if (!trackName) return null;
  const fromPackage = dateRuleFromPackages(packages, trackName);
  if (fromPackage) return fromPackage;
  const template = TRACK_TEMPLATES.find((item) => item.name === trackName);
  return template?.dateRule ?? null;
}

/** 模板的科目满分合计。没有科目就是 0。 */
export function templateFullMarks(subjects: TrackSubjectTemplate[]): number {
  return subjects.reduce((sum, subject) => sum + subject.fullMark, 0);
}

/** 模板的科目目标合计。 */
export function templateGoalSum(subjects: TrackSubjectTemplate[]): number {
  return subjects.reduce((sum, subject) => sum + subject.goal, 0);
}

/** 引导 / 设置流程里一行科目的样子。 */
export type TemplateSubjectRow = {
  key: string;
  label: string;
  fullMark: number;
  goal: number;
  unit: string;
};

/**
 * 把「模板给的科目」与「库里已有的科目」合成一份清单。
 *
 * 模板定义这条赛道应该有哪些科、满分多少；库里存着用户实际改过的目标分。
 * 同名以库里的目标为准，库里多出来的科目（用户自己加的）也带上。
 *
 * `includeExtra` 关掉时只保留模板里的科目：引导流程用这个——
 * 引导时用户还没选定赛道，不该看到上一条赛道多出来的科目。
 */
export function mergeTemplateSubjects(
  template: TrackTemplate,
  stored: Pick<Subject, "key" | "label" | "fullMark" | "goal" | "unit">[],
  includeExtra = true,
): TemplateSubjectRow[] {
  const byKey = new Map(stored.map((item) => [item.key, item]));
  const rows: TemplateSubjectRow[] = template.subjects.map((subject) => ({
    key: subject.key,
    label: subject.label,
    fullMark: subject.fullMark,
    goal: byKey.get(subject.key)?.goal ?? subject.goal,
    unit: subject.unit ?? "分",
  }));
  if (!includeExtra) return rows;
  for (const item of stored) {
    if (rows.some((row) => row.key === item.key)) continue;
    rows.push({
      key: item.key,
      label: item.label,
      fullMark: item.fullMark ?? 0,
      goal: item.goal ?? 0,
      unit: item.unit ?? "分",
    });
  }
  return rows;
}

/**
 * 一条赛道的完整画像：赛道本身 + 它下面的科目 + 它的目标。
 *
 * 4.0 起这三样都落在库里（`tracks` / `subjects` / `goals`），
 * 页面拿这份画像就能渲染出「我在追什么」。
 */
export type TrackProfile = {
  /** 当前赛道。库里一条都没有时是 null。 */
  track: Track | null;
  /** 这条赛道下的科目。 */
  subjects: Subject[];
  /** 这条赛道下的目标（含主目标）。 */
  goals: Goal[];
};

/** 各科目标合计。没有目标分的科目按 0 算。 */
export function trackSubjectTotal(subjects: Subject[]): number {
  return subjects.reduce((sum, subject) => sum + (subject.goal ?? 0), 0);
}

/**
 * 找这条赛道下的目标。
 *
 * 优先用归属这条赛道的目标；没有就退回主目标，再没有就取第一条。
 */
export function resolveGoalForTrack(
  goals: Goal[],
  trackId: number | null,
): Goal | null {
  if (trackId != null) {
    const scoped = goals.find((goal) => goal.trackId === trackId);
    if (scoped) return scoped;
  }
  return goals.find((goal) => goal.isPrimary) ?? goals[0] ?? null;
}
