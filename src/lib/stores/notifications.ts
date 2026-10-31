import { writable, get } from "svelte/store";
import { MAX_VISIBLE_TOASTS, pickEvictedToast, remainingAfterRun } from "./toastTimers";

export type NoticeKind = "info" | "success" | "warn" | "error";

export interface Notice {
  id: number;
  kind: NoticeKind;
  title: string;
  message?: string;
  ttlMs: number;   // total time until auto-dismiss
  startedAt: number;
  // Auto-dismiss bookkeeping. The CSS progress bar pauses on the same hover,
  // so `remainingMs` always matches what the bar still shows.
  remainingMs: number;
  runningSince: number | null; // performance.now() when the clock last started; null while hovered
}

let nextId = 1;
const DEFAULT_TTL = 5000;

export const notices = writable<Notice[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function clearTimer(id: number): void {
  const t = timers.get(id);
  if (t !== undefined) clearTimeout(t);
  timers.delete(id);
}

function startTimer(id: number, ms: number): void {
  timers.set(id, setTimeout(() => dismiss(id), ms));
}

function patchNotice(id: number, patch: Partial<Notice>): void {
  notices.update((arr) => arr.map((n) => (n.id === id ? { ...n, ...patch } : n)));
}

export function notify(opts: {
  kind: NoticeKind;
  title: string;
  message?: string;
  ttlMs?: number;
}): number {
  const id = nextId++;
  const now = performance.now();
  const ttl = opts.ttlMs ?? DEFAULT_TTL;
  const n: Notice = {
    id,
    kind: opts.kind,
    title: opts.title,
    message: opts.message,
    ttlMs: ttl,
    startedAt: now,
    remainingMs: ttl,
    runningSince: now,
  };
  // Evict before adding so the stack never exceeds MAX_VISIBLE_TOASTS. The
  // candidates are the toasts already showing, never the one arriving now.
  const current = get(notices);
  const evicted = pickEvictedToast(current, MAX_VISIBLE_TOASTS);
  if (evicted !== null) clearTimer(evicted);
  notices.set([...current.filter((x) => x.id !== evicted), n]);
  startTimer(id, ttl);
  return id;
}

export function dismiss(id: number) {
  clearTimer(id);
  notices.update((arr) => arr.filter((n) => n.id !== id));
}

export function dismissAll() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  notices.set([]);
}

/** Stops a toast's auto-dismiss clock while the pointer is over it. Repeat
 * calls, and calls for toasts already gone, do nothing.
 * Example: pauseNotice(id) from the toast's mouseenter */
export function pauseNotice(id: number): void {
  const n = get(notices).find((x) => x.id === id);
  if (!n || n.runningSince === null) return;
  clearTimer(id);
  const left = remainingAfterRun(n.remainingMs, n.runningSince, performance.now());
  patchNotice(id, { remainingMs: left, runningSince: null });
}

/** Restarts a paused toast's clock with the time it had left. */
export function resumeNotice(id: number): void {
  const n = get(notices).find((x) => x.id === id);
  if (!n || n.runningSince !== null) return;
  patchNotice(id, { runningSince: performance.now() });
  startTimer(id, n.remainingMs);
}

// Convenience helpers used by withBusy wrappers / actions.
export function notifySuccess(title: string, message?: string) {
  notify({ kind: "success", title, message });
}
export function notifyInfo(title: string, message?: string) {
  notify({ kind: "info", title, message });
}
export function notifyWarn(title: string, message?: string, ttlMs = 6000) {
  notify({ kind: "warn", title, message, ttlMs });
}
export function notifyError(title: string, message?: string, ttlMs = 8000) {
  notify({ kind: "error", title, message, ttlMs });
}

// Run an async action and emit a success notice if it didn't throw.
// Used by call sites that want a single-line "do X then toast".
export async function withNotice<T>(
  ok: { title: string; message?: string },
  fail: (e: unknown) => { title: string; message?: string },
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    const r = await fn();
    notifySuccess(ok.title, ok.message);
    return r;
  } catch (e) {
    const f = fail(e);
    notifyError(f.title, f.message);
    return null;
  }
}

// Read-only snapshot for tests/log integration.
export function snapshot(): Notice[] { return get(notices); }
