/**
 * 轮次命名。
 *
 * 任务的学习过程按「轮次」推进，第 1 轮是教材学习，之后依次是
 * 第一轮复习、第二轮复习…… 数据库里的 `round` 仍然是 1 起的整数，
 * 这里只负责把它翻译成人话：所有显示轮次的地方都走同一套叫法，
 * 筛选标签和任务卡片说的是同一件事。
 */

/** 1–10 用汉字，再往后用阿拉伯数字。 */
const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 轮次序号的中文写法。 */
export function roundNumberLabel(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const n = Math.trunc(value);
  if (n < 1 || n > 10) return String(n);
  if (n === 10) return "十";
  return CN_DIGITS[n];
}

/**
 * 轮次的展示名。
 *
 * 第 1 轮叫「教材学习」，第 n 轮（n ≥ 2）叫「第 n-1 轮复习」：
 * 教材学习排在第一轮复习前面，这是高考复习的常规顺序。
 */
export function roundName(round: number): string {
  if (!Number.isFinite(round) || round <= 1) return "教材学习";
  return `第${roundNumberLabel(round - 1)}轮复习`;
}

/** 一个任务的完整阶段序列：教材学习 → 第一轮复习 → … */
export function roundSequence(totalRounds: number): string[] {
  const total = Math.max(1, Math.trunc(totalRounds) || 1);
  return Array.from({ length: total }, (_, index) => roundName(index + 1));
}

/** 复习轮次数量：总轮次减去「教材学习」这一轮。 */
export function reviewRoundCount(totalRounds: number): number {
  return Math.max(0, Math.trunc(totalRounds) - 1);
}
