// Pure rules for searching commits beyond the loaded graph (docs/specs/history-search.md).
// No store or IPC imports, so bun test runs them. The wiring lives in
// src/lib/stores/historySearch.ts.

export const REMOTE_MIN_CHARS = 3;
export const REMOTE_DEBOUNCE_MS = 300;
export const MAX_OLDER_PAGES = 10;
// Waits between retries when a page load was a no-op (a scroll load is in flight).
export const LOAD_RETRY_MS = 150;
// Upper bound on load attempts, so a page that never starts cannot loop forever.
const MAX_LOAD_ATTEMPTS = 100;

/** The backend hits for one query. `shas` are newest first. */
export interface RemoteHits {
  query: string;
  shas: string[];
}

/** Injected timer pair, so the debounce runs under a fake clock in tests. */
export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** True when a query is long enough for a backend search. Shorter queries match
 * too many commits to be useful. Example: shouldSearchRemote("fix") is true. */
export function shouldSearchRemote(query: string): boolean {
  return query.trim().length >= REMOTE_MIN_CHARS;
}

/** The backend shas for `query`, or none when the hits belong to another query
 * (they are stale). Example: remoteShasFor(hits, "fix login") */
export function remoteShasFor(hits: RemoteHits | null, query: string): string[] {
  if (!hits || hits.query !== query.trim()) return [];
  return hits.shas;
}

/** Backend hits whose commit is not loaded yet, in the order given (newest first).
 * Example: olderMatches(["b", "a"], new Set(["a"])) gives ["b"]. */
export function olderMatches(shas: readonly string[], loaded: ReadonlySet<string>): string[] {
  return shas.filter((sha) => !loaded.has(sha));
}

/** Dependencies of the older-history load. The store passes the real ones; tests
 * pass a fake. */
export interface OlderLoadDeps {
  isLoaded(sha: string): boolean;
  hasMore(): boolean;
  /** Loads one page. Resolves false when nothing started (busy or no-op). */
  loadPage(): Promise<boolean>;
  wait(ms: number): Promise<void>;
  cancelled(): boolean;
}

/** Loads older pages until `target` is in the graph. At most MAX_OLDER_PAGES pages.
 * Returns whether `target` is loaded at the end.
 * WHY the retry wait: a scroll-triggered page may be in flight, and loadPage does
 * nothing while it runs. Waiting lets that page finish instead of skipping it.
 * Example: `await loadOlderUntil(sha, deps)` */
export async function loadOlderUntil(target: string, deps: OlderLoadDeps): Promise<boolean> {
  let pages = 0;
  let attempts = 0;
  while (!deps.cancelled() && !deps.isLoaded(target) && pages < MAX_OLDER_PAGES) {
    if (!deps.hasMore() || attempts >= MAX_LOAD_ATTEMPTS) break;
    attempts++;
    if (await deps.loadPage()) pages++;
    else await deps.wait(LOAD_RETRY_MS);
  }
  return deps.isLoaded(target);
}

/** Runs one callback after a quiet period. Each schedule replaces the pending one,
 * so only the last query of a burst of keystrokes is searched.
 * Example: `const d = new TrailingDebounce(300, timers); d.schedule(run)` */
export class TrailingDebounce {
  private handle: unknown = null;
  private readonly delayMs: number;
  private readonly timers: Timers;

  constructor(delayMs: number, timers: Timers) {
    this.delayMs = delayMs;
    this.timers = timers;
  }

  /** Replaces any pending callback with `run`, which fires after the delay. */
  schedule(run: () => void): void {
    this.cancel();
    this.handle = this.timers.set(() => {
      this.handle = null;
      run();
    }, this.delayMs);
  }

  /** Drops the pending callback, if any. */
  cancel(): void {
    if (this.handle === null) return;
    this.timers.clear(this.handle);
    this.handle = null;
  }
}
