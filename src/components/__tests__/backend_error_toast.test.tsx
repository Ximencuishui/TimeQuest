import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BackendErrorToast } from "../BackendErrorToast";
import { BACKEND_ERROR_EVENT } from "../../lib/backendError";

function emit(error: unknown) {
  act(() => {
    window.dispatchEvent(new CustomEvent(BACKEND_ERROR_EVENT, { detail: error }));
  });
}

describe("全局后端错误提示", () => {
  afterEach(cleanup);

  it("中文业务错误原样显示", () => {
    render(<BackendErrorToast />);
    emit("日期格式不对：2026-1-1");
    expect(screen.getByRole("alert")).toHaveTextContent("日期格式不对：2026-1-1");
  });

  it("英文技术错误换成中文兜底，且相同错误不重复堆叠", () => {
    render(<BackendErrorToast />);
    emit(new Error("UNIQUE_SQLITE_FAILURE"));
    emit(new Error("UNIQUE_SQLITE_FAILURE"));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("操作失败，请重试。");
  });
});
