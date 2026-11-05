import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/** Recharts ResponsiveContainer needs layout measurements in jsdom. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

/** Minimal Tauri invoke mock — tests override per-command return values. */
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));
