/**
 * 单位口径：任务自带 `unit_name`（教材导入为「节」，手建任务默认「课」）。
 * 界面上凡是出现「计划 N」「实际 N」的地方，都用任务自己的单位说清楚，
 * 避免学生猜「1 课 = 一节课还是一节教材」。
 */

/** 任务没有单位时的兜底文案。 */
export const DEFAULT_UNIT_NAME = "课";

/** 取任务的单位名；空值回落到「课」。 */
export function unitNameOf(
  source: { task_unit_name?: string | null } | null | undefined,
): string {
  const name = source?.task_unit_name?.trim();
  return name && name.length > 0 ? name : DEFAULT_UNIT_NAME;
}

/** 「2 节」这类单位文案。 */
export function unitsLabel(count: number, unit: string): string {
  return `${count} ${unit}`;
}

/**
 * 「实际 N 数」这类字段名：单位是「课」→ 实际课数；是「节」→ 实际节数。
 */
export function actualUnitsLabel(unit: string): string {
  return `实际${unit}数`;
}
