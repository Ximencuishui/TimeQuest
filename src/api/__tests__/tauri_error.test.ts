import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../tauri";
import { BACKEND_ERROR_EVENT } from "../../lib/backendError";

const mockedInvoke = vi.mocked(invoke);

describe("Tauri command 错误广播", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("command 失败时广播错误，并把原始错误继续抛给调用方", async () => {
    const handler = vi.fn();
    window.addEventListener(BACKEND_ERROR_EVENT, handler);
    mockedInvoke.mockRejectedValueOnce(new Error("database is locked"));

    await expect(api.listTasks()).rejects.toThrow("database is locked");
    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener(BACKEND_ERROR_EVENT, handler);
  });

  it("command 成功时不广播", async () => {
    const handler = vi.fn();
    window.addEventListener(BACKEND_ERROR_EVENT, handler);
    mockedInvoke.mockResolvedValueOnce([]);

    await expect(api.listTasks()).resolves.toEqual([]);
    expect(handler).not.toHaveBeenCalled();

    window.removeEventListener(BACKEND_ERROR_EVENT, handler);
  });
});
