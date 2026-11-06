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

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => undefined),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => "denied"),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => {
  class WebviewWindow {
    static getByLabel = vi.fn(async () => null);
    label: string;
    constructor(label: string) {
      this.label = label;
    }
    once() {
      return Promise.resolve(() => undefined);
    }
    show() {
      return Promise.resolve();
    }
    hide() {
      return Promise.resolve();
    }
    isVisible() {
      return Promise.resolve(false);
    }
    setAlwaysOnTop() {
      return Promise.resolve();
    }
  }
  return { WebviewWindow };
});
