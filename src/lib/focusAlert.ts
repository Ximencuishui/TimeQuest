import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { APP_NAME } from "./constants";

/** Short sine chime. No audio file; stays quiet when the device has no audio. */
export function playFocusChime(): void {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => {
      void ctx.close();
    };
  } catch {
    /* no audio output */
  }
}

export function notifyFocusFinished(taskTitle: string): void {
  if (!isTauri()) return;
  void (async () => {
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        granted = (await requestPermission()) === "granted";
      }
      if (!granted) return;
      sendNotification({
        title: APP_NAME,
        body: `「${taskTitle}」专注结束了，去记下这一课吧。`,
      });
    } catch {
      /* permission prompt or plugin missing */
    }
  })();
}
