import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { vi } from "vitest";

/**
 * waitFor 默认超时只有 1s；全量并行时机器负载高，Settings 等重页面容易误报超时。
 * 这里统一放宽到 5s（只放宽等待上限，不改任何断言）。
 */
configure({ asyncUtilTimeout: 5000 });

/** Recharts ResponsiveContainer needs layout measurements in jsdom. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

/**
 * jsdom 没实现 scrollIntoView：时间线滚到当前场次时会直接抛错，
 * React 把整棵树卸掉，测试就变成“找不到元素”。
 */
Element.prototype.scrollIntoView = function scrollIntoView() {};

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
