import { describe, expect, it, vi } from "vitest";
import { backendErrorDetail } from "../backendError";

describe("backendErrorDetail 后端错误文案", () => {
  it("backend_error_detail_passes_chinese_errors_through", () => {
    // 后端写的业务错误本来就是中文，原样透出。
    expect(backendErrorDetail("日期格式不对：2026-1-1", "请稍后再试。")).toBe(
      "日期格式不对：2026-1-1",
    );
  });

  it("backend_error_detail_replaces_english_errors_with_fallback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(backendErrorDetail("database error: database is locked", "请稍后再试。")).toBe(
        "请稍后再试。",
      );
      // 原文只进控制台，不进界面。
      expect(warn).toHaveBeenCalledWith(
        "[backend error]",
        "database error: database is locked",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("backend_error_detail_falls_back_for_empty_errors", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(backendErrorDetail(null, "请稍后再试。")).toBe("请稍后再试。");
      expect(backendErrorDetail(undefined, "请稍后再试。")).toBe("请稍后再试。");
      expect(backendErrorDetail("", "请稍后再试。")).toBe("请稍后再试。");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("backend_error_detail_reads_message_and_error_shapes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(backendErrorDetail(new Error("数据库被占用"), "请稍后再试。")).toBe("数据库被占用");
      expect(backendErrorDetail({ message: "时段撞车" }, "请稍后再试。")).toBe("时段撞车");
      expect(backendErrorDetail({ error: "disk full" }, "请稍后再试。")).toBe("请稍后再试。");
    } finally {
      warn.mockRestore();
    }
  });
});
