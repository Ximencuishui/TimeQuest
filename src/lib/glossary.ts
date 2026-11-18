/**
 * 术语词条与数字来源说明。
 *
 * 面向「不懂技术、只想把书读好」的用户：界面上出现的每个术语和数字
 * 都能在这里查到它到底怎么来的，避免「数字从天而降」的黑箱感。
 *
 * 口径必须与实现一致：
 * - XP / 连击 / 等级：`src-tauri/src/gamification.rs`
 * - 达成率：`src-tauri/src/commands/stats.rs`
 * - 本轮进度：`task_progress`（当前轮 `sum(actual_units)`）
 * - 今日剩余待学：`src/lib/studyCountdown.ts`
 */

export type GlossaryEntry = {
  /** 稳定 id，供 `GlossaryHint` 引用。 */
  id: string;
  /** 术语名。 */
  term: string;
  /** 问句形式，作为提示按钮的无障碍名称。 */
  question: string;
  /** 一句话解释。 */
  summary: string;
  /** 计算口径（怎么算出来的）。 */
  formula?: string;
  /** 数据来源（从哪来）。 */
  source?: string;
};

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: "xp",
    term: "XP（经验值）",
    question: "XP 是怎么算出来的？",
    summary: "只有真正完成的课数才给 XP，没学的排期一点不给。",
    formula:
      "XP = 实际完成课数 × 基础值（主线 12 / 副本 10）× 自评系数 × 连击倍率，最后四舍五入。改期后补做，额外 +5 XP 恢复奖励。",
    source: "完成一条排期时结算，写在同一笔事务里，重复点不会重复发。",
  },
  {
    id: "level",
    term: "等级（Lv.）",
    question: "等级是怎么升上去的？",
    summary: "等级只看累计 XP，欠着不补也不扣，只是升得慢一点。",
    formula: "升到下一级需要的 XP = 100 × 当前等级^1.5（Lv.1 → 100，Lv.2 → 283，Lv.3 → 520…）。",
    source: "由累计 XP 换算，等级进度条显示「本级已得 / 升下一级还差多少」。",
  },
  {
    id: "streak",
    term: "连击",
    question: "连击天数怎么算？",
    summary: "连着几天都有完成记录就算连击；断一天会从头开始，但历史最长纪录一直保留。",
    formula:
      "按本地自然日算：同一天多次完成不重复加；隔一天完成就 +1；隔了更久就重置为 1。倍率 3 天 1.1、7 天 1.2、14 天 1.3、30 天 1.5。",
    source: "完成排期时按完成日期更新，断连只重置倍率，不清历史最长连击。",
  },
  {
    id: "self_rating",
    term: "自评（1–5 星）",
    question: "自评星星有什么用？",
    summary: "自评只对 XP 做一点小幅加成，不影响进度，也不会因为低分被惩罚。",
    formula: "1–2 星 ×0.9，3 星 ×1.0，4–5 星 ×1.2，不填按 ×1.0。",
    source: "完成排期时填写，写进完成记录，可以回看。",
  },
  {
    id: "progress_ring",
    term: "本轮进度（进度环）",
    question: "进度环上的数字是什么意思？",
    summary: "环里显示的是「这一轮已经完成多少课」，推进到下一轮会重新从 0 开始。",
    formula: "本轮完成课数 = 当前轮所有已完成排期的实际完成课数之和；分母是这一轮的总课数。",
    source: "任务详情页的 task_progress 数据，统计口径和任务列表一致。",
  },
  {
    id: "completion_rate",
    term: "计划达成率",
    question: "计划达成率怎么算的？",
    summary: "这一段时间里，真正按计划完成的排期占多少。改期不算失败，但也算没按时完成。",
    formula: "达成率 = 已完成 ÷（已完成 + 缺勤 + 已改期）。分母为 0 时显示 0%。",
    source: "统计页按所选自然周 / 自然月统计，只看这段时间内的排期。",
  },
  {
    id: "remaining",
    term: "今日剩余待学",
    question: "今日剩余待学是怎么算的？",
    summary: "今天还没开始的排期还要学多久；重叠的时段只算一次，超出每日上限就按上限算。",
    formula:
      "剩余待学 = 今天所有未完成排期的时段长度之和（重叠区间合并成一段，只算一次），并按「每日学习上限」封顶。",
    source: "首页与悬浮窗显示，数据来自今天这一天的排期。",
  },
  {
    id: "rescheduled",
    term: "改期",
    question: "改期会怎么样？",
    summary: "改期就是把一条排期挪到别的日期或时间。原来那条不会被删掉，会标成「已改期」，历史照样能查。",
    formula: "改期后完成，会额外给 +5 XP 恢复奖励，并解锁「绝地反击」成就（自评 4 星及以上且完成课数大于 0）。",
    source: "今日计划里点排期卡片 → 重新安排。",
  },
  {
    id: "main_side",
    term: "主线 / 副本",
    question: "主线和副本有什么区别？",
    summary: "主线是正课，必须啃完；副本是额外刷题、背诵，可以随缘。",
    formula: "主线的单位 XP 是 12，副本是 10；主线才有轮次和进度环。",
    source: "新建任务时选择类型。",
  },
  {
    id: "plan_vs_actual",
    term: "计划 vs 实际",
    question: "计划和实际差在哪？",
    summary: "计划是你原本排好的学习分钟数，实际是真正记下来的学习分钟数。",
    formula:
      "计划分钟 = 排期时段的长度之和；实际分钟 = 学习流水的时长之和（完成排期按时段长度记，手动补记按起止时间差记）。",
    source: "统计页「计划 vs 实际」图，按科目拆分。",
  },
  {
    id: "session",
    term: "排期（时段）",
    question: "排期是什么？",
    summary: "排期就是「某天的某个时间段，要学哪本书的哪几课」。它是这个 App 记录学习的基本单位。",
    formula: "一条排期包含日期、开始时间、结束时间、任务、轮次、计划课数；完成时再填实际课数和自评。",
    source: "今日计划 → 新建排期。",
  },
  {
    id: "daily_limit",
    term: "每日可用时段与上限",
    question: "每日时段和上限有什么用？",
    summary: "它们限制你每天最多学多久、用哪些时间段。「一键排一周」只会往这些空格里排，绝不会硬塞。",
    formula:
      "每日上限默认 8 小时（可在设置里改，60–720 分钟）；时段默认早读、上午、晚上三段。",
    source: "设置 → 每日学习计划。",
  },
];

/** 按 id 找词条；找不到返回 null。 */
export function glossaryEntry(id: string): GlossaryEntry | null {
  return GLOSSARY.find((entry) => entry.id === id) ?? null;
}
