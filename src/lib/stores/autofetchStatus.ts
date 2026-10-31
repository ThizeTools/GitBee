import { writable } from "svelte/store";

// Outcome of the last background fetch, shown in the status bar. Keyed by repo
// path: auto-fetch only runs for the active tab, so one shared value would show
// the previous repo's status after a tab switch.
export interface AutofetchStatus {
  lastFetchAt: number | null;
  lastFetchError: string | null;
}

export type AutofetchMap = Record<string, AutofetchStatus>;

export const autofetchStatus = writable<AutofetchMap>({});

// git's stderr can be long (a whole proxy page); the tooltip keeps the start.
const MAX_TOOLTIP_CHARS = 400;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const JUST_NOW_MS = 45_000;

export function withFetchSuccess(map: AutofetchMap, repo: string, at: number): AutofetchMap {
  return { ...map, [repo]: { lastFetchAt: at, lastFetchError: null } };
}

// The previous success time is kept, so a failure does not erase when the
// repo last fetched fine. An empty error still counts as a failure: the pill
// must show, or the failure is silent again.
export function withFetchFailure(map: AutofetchMap, repo: string, error: string): AutofetchMap {
  const previous = map[repo]?.lastFetchAt ?? null;
  const message = error.trim() || "git fetch failed without a message";
  return { ...map, [repo]: { lastFetchAt: previous, lastFetchError: message } };
}

/** "just now", "3 min ago", "2 h ago", "4 d ago". Future times read as "just now". */
export function formatFetchAge(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < JUST_NOW_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.max(1, Math.floor(elapsed / MINUTE_MS))} min ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  return `${Math.floor(elapsed / DAY_MS)} d ago`;
}

/** Full local date and time, for the tooltip next to the relative age. */
export function absoluteFetchTime(at: number): string {
  return new Date(at).toLocaleString();
}

/** Tooltip for the failure pill: git's stderr, truncated, then the retry hint. */
export function autofetchErrorTooltip(error: string): string {
  const text = error.trim();
  const shown = text.length > MAX_TOOLTIP_CHARS ? `${text.slice(0, MAX_TOOLTIP_CHARS)}…` : text;
  return `${shown}\n\nClick to retry the fetch now.`;
}
