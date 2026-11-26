/** 所有 Tauri command 失败时广播到全局错误提示的事件名。 */
export const BACKEND_ERROR_EVENT = "timequest:backend-error";

/** 让全局提示层收到一次后端失败；调用方仍可照常 catch 并做自己的处理。 */
export function notifyBackendError(err: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BACKEND_ERROR_EVENT, { detail: err }));
}

/**
 * 后端错误的用户可见文案。
 *
 * 后端把可预期的业务错误写成中文（例如「日期格式不对：…」），
 * 这种直接透出就行；数据库一类的技术错误是英文，甩给用户看不懂，
 * 这里换成中文兜底，原文只写进控制台方便排查。
 */

/** 从各种错误形态里取出原始文本。 */
function rawErrorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  if (err && typeof err === "object" && "error" in err) {
    return String((err as { error: unknown }).error);
  }
  if (err === null || err === undefined) return "";
  return String(err);
}

/** 含中文就当作已经写给用户看的文案。 */
function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/**
 * 取出拼在提示语后面的错误细节。
 *
 * 中文错误原样透出；英文或空错误换成 `fallback`，
 * 同时把原文写进控制台，不让英文技术报错直接出现在界面上。
 */
export function backendErrorDetail(err: unknown, fallback: string): string {
  const raw = rawErrorText(err).trim();
  if (!raw) return fallback;
  if (hasChinese(raw)) return raw;
  console.warn("[backend error]", raw);
  return fallback;
}
