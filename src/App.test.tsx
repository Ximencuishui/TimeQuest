import { isTauri, invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    throw new TypeError(
      "Cannot read properties of undefined (reading 'metadata')",
    );
  },
}));

describe("BootSync setAlwaysOnTop", () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async () => null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("warns once when getCurrentWindow throws and still renders", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<App />);

    expect(
      screen.getByRole("heading", { name: "TimeQuest" }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(warn).toHaveBeenCalledTimes(1);
    });
    expect(String(warn.mock.calls[0]?.[0])).toContain("setAlwaysOnTop");
    expect(error).not.toHaveBeenCalled();
  });
});
