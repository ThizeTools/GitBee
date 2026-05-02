import { writable, get } from "svelte/store";

export type NoticeKind = "info" | "success" | "warn" | "error";

export interface Notice {
  id: number;
  kind: NoticeKind;
  title: string;
  message?: string;
  ttlMs: number;   // total time until auto-dismiss
  startedAt: number;
}

let nextId = 1;
const DEFAULT_TTL = 5000;

export const notices = writable<Notice[]>([]);

export function notify(opts: {
  kind: NoticeKind;
  title: string;
  message?: string;
  ttlMs?: number;
}): number {
  const id = nextId++;
  const n: Notice = {
    id,
    kind: opts.kind,
    title: opts.title,
    message: opts.message,
    ttlMs: opts.ttlMs ?? DEFAULT_TTL,
    startedAt: performance.now(),
  };
  notices.update((arr) => [...arr, n]);
  setTimeout(() => dismiss(id), n.ttlMs);
  return id;
}

export function dismiss(id: number) {
  notices.update((arr) => arr.filter((n) => n.id !== id));
}

export function dismissAll() {
  notices.set([]);
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
