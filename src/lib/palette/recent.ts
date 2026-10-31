// Recently run palette items, newest first. Shown before everything else when
// the query is empty. Persistence is a convenience: every storage access is
// wrapped, so a blocked or full localStorage just means no memory across runs.

import { writable, get } from "svelte/store";

export const RECENT_LIMIT = 8;
export const RECENT_STORAGE_KEY = "gkp.palette.recent.v1";

type RecentStorage = Pick<Storage, "getItem" | "setItem">;

/** Moves `id` to the front, drops any older copy, and keeps the newest RECENT_LIMIT ids. */
export function pushRecent(ids: readonly string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, RECENT_LIMIT);
}

/** Parses the stored JSON. Anything that is not an array of strings reads as empty. */
export function parseRecent(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function readRecent(storage: RecentStorage | null): string[] {
  if (storage === null) return [];
  try {
    return parseRecent(storage.getItem(RECENT_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeRecent(storage: RecentStorage | null, ids: readonly string[]): void {
  if (storage === null) return;
  try {
    storage.setItem(RECENT_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Quota or disabled storage: losing recents is acceptable, failing the palette is not.
  }
}

/** The app's localStorage, or null when it is absent or its access throws (some sandboxed webviews). */
export function defaultStorage(): RecentStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export const recentIds = writable<string[]>(readRecent(defaultStorage()));

/** Records a run in the store and in storage. */
export function rememberRecent(id: string): void {
  const next = pushRecent(get(recentIds), id);
  recentIds.set(next);
  writeRecent(defaultStorage(), next);
}

/**
 * Puts the items named in `ids` first, in that order. Ids that match no item
 * are skipped; the remaining items keep their original order.
 */
export function recentFirst<T extends { id: string }>(items: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  const head: T[] = [];
  const headIds = new Set<string>();
  for (const id of ids) {
    const item = byId.get(id);
    if (item !== undefined && !headIds.has(id)) {
      head.push(item);
      headIds.add(id);
    }
  }
  return [...head, ...items.filter((item) => !headIds.has(item.id))];
}
