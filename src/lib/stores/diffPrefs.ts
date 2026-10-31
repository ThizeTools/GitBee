// Diff viewer preferences shared by every diff surface (center diff panel,
// commit and stash details). Persisted in localStorage, which only holds
// per-viewer conveniences: when storage is blocked or throws, the app keeps
// the in-memory value and never shows an error.
import { get, writable, type Writable } from "svelte/store";

export type DiffLayout = "unified" | "split";

export interface DiffPrefs {
  layout: DiffLayout;
  /** Passes `-w` to git. Hunk staging must not use it (diff-viewer spec). */
  ignoreWs: boolean;
}

const STORAGE_KEY = "gitbee.diffPrefs";

export const DEFAULT_DIFF_PREFS: DiffPrefs = { layout: "unified", ignoreWs: false };

/**
 * Reads a stored preferences blob. Each field falls back on its own, so a
 * hand-edited or outdated value never breaks the diff view.
 * Usage: parseDiffPrefs('{"layout":"split"}') keeps ignoreWs at its default.
 */
export function parseDiffPrefs(raw: string | null): DiffPrefs {
  const value = parseJson(raw);
  if (!isRecord(value)) return { ...DEFAULT_DIFF_PREFS };
  return {
    layout: value.layout === "split" ? "split" : "unified",
    ignoreWs: value.ignoreWs === true,
  };
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStored(prefs: DiffPrefs): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private windows and blocked site data throw here; the store keeps the value.
  }
}

export const diffPrefs: Writable<DiffPrefs> = writable(parseDiffPrefs(readStored()));

export function setDiffLayout(layout: DiffLayout): void {
  commit({ ...get(diffPrefs), layout });
}

export function setIgnoreWs(ignoreWs: boolean): void {
  commit({ ...get(diffPrefs), ignoreWs });
}

function commit(next: DiffPrefs): void {
  diffPrefs.set(next);
  writeStored(next);
}
