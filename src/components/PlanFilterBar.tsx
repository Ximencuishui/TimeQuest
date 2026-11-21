import {
  emptyPlanFilter,
  isPlanFilterActive,
  toggleFilterValue,
  type PlanFilter,
  type PlanTags,
} from "../lib/planViews";
import { roundName } from "../lib/rounds";

type Props = {
  tags: PlanTags;
  filter: PlanFilter;
  onChange: (filter: PlanFilter) => void;
  /** 命中数量 / 总数量，给用户一个「筛掉了多少」的直白反馈。 */
  matchedCount: number;
  totalCount: number;
};

type Dimension = {
  key: "subjects" | "textbooks" | "rounds";
  label: string;
  hint: string;
};

/**
 * 总计划的筛选栏：学科 / 课本 / 轮次三个维度。
 *
 * 同一维度里可以多选（等于「或」），不同维度组合起来是「且」。
 * 再点一次同一个标签就取消，不需要额外的「应用」按钮——防呆优先。
 */
export function PlanFilterBar({
  tags,
  filter,
  onChange,
  matchedCount,
  totalCount,
}: Props) {
  const dimensions: Dimension[] = [
    { key: "subjects", label: "学科", hint: "按学科筛主线" },
    { key: "textbooks", label: "课本", hint: "按课本筛主线" },
    {
      key: "rounds",
      label: "轮次",
      hint: "按学习阶段筛：教材学习 → 第一轮复习 → 第二轮复习…",
    },
  ];

  const active = isPlanFilterActive(filter);

  // 三个维度的值类型不同（轮次是数字），分开处理才能保证类型对得上。
  const toggle = (dimension: Dimension, value: string | number) => {
    if (dimension.key === "rounds") {
      onChange({
        ...filter,
        rounds: toggleFilterValue(filter.rounds, Number(value)),
      });
      return;
    }
    if (dimension.key === "subjects") {
      onChange({
        ...filter,
        subjects: toggleFilterValue(filter.subjects, String(value)),
      });
      return;
    }
    onChange({
      ...filter,
      textbooks: toggleFilterValue(filter.textbooks, String(value)),
    });
  };

  return (
    <section
      aria-label="总计划筛选"
      data-testid="plan-filter-bar"
      className="mb-4 rounded-xl border border-white/5 bg-surface-2/60 px-3 py-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {dimensions.map((dimension) => {
            const values = tags[dimension.key];
            if (values.length === 0) return null;
            return (
              <div key={dimension.key} className="flex items-center gap-1.5">
                <span className="text-[11px] text-ink-muted/70">
                  {dimension.label}
                </span>
                <div className="flex flex-wrap gap-1">
                  {values.map((value) => {
                    const selected =
                      dimension.key === "rounds"
                        ? filter.rounds.includes(Number(value))
                        : dimension.key === "subjects"
                          ? filter.subjects.includes(String(value))
                          : filter.textbooks.includes(String(value));
                    const text =
                      dimension.key === "rounds"
                        ? roundName(Number(value))
                        : String(value);
                    return (
                      <button
                        key={String(value)}
                        type="button"
                        aria-pressed={selected}
                        title={dimension.hint}
                        data-testid={`plan-filter-${dimension.key}-${value}`}
                        className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                          selected
                            ? "border-accent/60 bg-accent/15 text-accent-soft"
                            : "border-white/10 text-ink-muted hover:border-white/20 hover:text-ink"
                        }`}
                        onClick={() => toggle(dimension, value)}
                      >
                        {text}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {tags.subjects.length === 0 &&
          tags.textbooks.length === 0 &&
          tags.rounds.length === 0 ? (
            <span className="text-[11px] text-ink-muted/70">
              新建任务后，这里会出现学科、课本和轮次标签。
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-muted">
            {active
              ? `命中 ${matchedCount} / ${totalCount} 个任务`
              : `共 ${totalCount} 个任务`}
          </span>
          {active ? (
            <button
              type="button"
              className="rounded-lg border border-white/10 px-2 py-0.5 text-[11px] text-ink-muted transition hover:text-ink"
              onClick={() => onChange(emptyPlanFilter())}
            >
              清空筛选
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
