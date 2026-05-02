import { writable, get } from "svelte/store";

export type LogLevel = "info" | "warn" | "error";
export interface LogLine { ts: number; level: LogLevel; msg: string; }

const MAX = 1000;

export const appLogs = writable<LogLine[]>([]);
export const logsPanelOpen = writable<boolean>(false);

export function logAppend(level: LogLevel, msg: string) {
  appLogs.update((arr) => {
    const next = [...arr, { ts: Date.now(), level, msg }];
    return next.length > MAX ? next.slice(next.length - MAX) : next;
  });
}
export function logsClear() { appLogs.set([]); }

export function snapshotAppLogs(): LogLine[] { return get(appLogs); }

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function pad(n: number): string { return String(n).padStart(2, "0"); }

// GitKraken-style action logging. Emits "<label>: started.", then either
// "<label>: finished. <Nms>" or "<label>: failed. <error>". Returns the
// underlying result (or { ok: false, error } so callers can show the real
// error in toasts/UI).
export type ActionResult<T> =
  | { ok: true; value: T; ms: number }
  | { ok: false; error: string; ms: number };

export async function logAction<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  const t0 = performance.now();
  logAppend("info", `${label}: started.`);
  try {
    const value = await fn();
    const ms = Math.round(performance.now() - t0);
    logAppend("info", `${label}: finished. ${ms}ms`);
    return { ok: true, value, ms };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const error = String(e ?? "unknown error");
    logAppend("error", `${label}: failed. ${error}`);
    return { ok: false, error, ms };
  }
}
