import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateField } from "../DateField";
import { TimeField } from "../TimeField";
import { TimeRangeField } from "../TimeRangeField";

afterEach(() => {
  cleanup();
});

/** 受控包装：让组件的值跟着点击变化。 */
function DateFieldHarness({
  initial = "2026-11-18",
  onChange,
}: {
  initial?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateField
      label="日期"
      value={value}
      today="2026-11-18"
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function TimeFieldHarness({
  initial = "09:00",
  onChange,
}: {
  initial?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TimeField
      label="开始"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function TimeRangeHarness({
  onChange,
}: {
  onChange?: (start: string, end: string) => void;
}) {
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  return (
    <TimeRangeField
      start={start}
      end={end}
      onChange={(nextStart, nextEnd) => {
        setStart(nextStart);
        setEnd(nextEnd);
        onChange?.(nextStart, nextEnd);
      }}
    />
  );
}

describe("DateField 自绘日期", () => {
  it("date_field_shows_relative_label_and_opens_shortcuts", () => {
    render(<DateFieldHarness />);

    const trigger = screen.getByRole("button", { name: /日期/ });
    expect(trigger).toHaveTextContent("今天");
    expect(trigger).toHaveTextContent("11月18日");

    fireEvent.click(trigger);
    expect(screen.getByRole("group", { name: "日期快捷" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "明天" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "后天" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下周一" })).toBeInTheDocument();
  });

  it("date_field_shortcut_picks_tomorrow", () => {
    const onChange = vi.fn();
    render(<DateFieldHarness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /日期/ }));
    fireEvent.click(screen.getByRole("button", { name: "明天" }));

    expect(onChange).toHaveBeenCalledWith("2026-11-19");
    // 选中后面板收起。
    expect(screen.queryByRole("group", { name: "日期快捷" })).not.toBeInTheDocument();
  });

  it("date_field_grid_picks_a_day_and_marks_today", () => {
    const onChange = vi.fn();
    render(<DateFieldHarness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /日期/ }));
    const day = screen.getByTestId("date-field-day-2026-11-25");
    expect(day).toBeInTheDocument();
    fireEvent.click(day);

    expect(onChange).toHaveBeenCalledWith("2026-11-25");
  });

  it("date_field_can_move_to_next_month", () => {
    render(<DateFieldHarness />);

    fireEvent.click(screen.getByRole("button", { name: /日期/ }));
    expect(screen.getByText("2026年11月")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下个月" }));
    expect(screen.getByText("2026年12月")).toBeInTheDocument();
    expect(screen.getByTestId("date-field-day-2026-12-01")).toBeInTheDocument();
  });
});

describe("TimeField 自绘时间", () => {
  it("time_field_picks_hour_then_minute", () => {
    const onChange = vi.fn();
    render(<TimeFieldHarness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /开始/ }));
    fireEvent.click(screen.getByRole("button", { name: "开始 14 点" }));
    expect(onChange).toHaveBeenLastCalledWith("14:00");

    fireEvent.click(screen.getByRole("button", { name: "开始 30 分" }));
    expect(onChange).toHaveBeenLastCalledWith("14:30");
  });

  it("time_field_exact_input_updates_value", () => {
    const onChange = vi.fn();
    render(<TimeFieldHarness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /开始/ }));
    fireEvent.change(screen.getByLabelText("开始（精确到分）"), {
      target: { value: "07:45" },
    });

    expect(onChange).toHaveBeenCalledWith("07:45");
  });
});

describe("TimeRangeField 时段快捷", () => {
  it("time_range_field_applies_preset_slot_in_one_click", () => {
    const onChange = vi.fn();
    render(<TimeRangeHarness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "晚上 19:00–20:00" }));

    expect(onChange).toHaveBeenCalledWith("19:00", "20:00");
    expect(screen.getByRole("button", { name: /开始/ })).toHaveTextContent("19:00");
    expect(screen.getByRole("button", { name: /结束/ })).toHaveTextContent("20:00");
  });

  it("time_range_field_extends_end_by_duration", () => {
    const onChange = vi.fn();
    render(<TimeRangeHarness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "1 小时 30 分钟" }));

    expect(onChange).toHaveBeenCalledWith("09:00", "10:30");
  });
});
