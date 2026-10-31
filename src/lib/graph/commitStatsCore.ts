// Changes-column data: per-commit file and line counts, requested for the rows
// the user can see. Pure helpers plus a class whose git call is injected, so
// the debounce, de-duplication, chunking and LRU are testable without Tauri.
// The app-wide instance is wired in stores/commitStatsCache.ts.
// See docs/specs/graph-columns-and-markers.md (Changes column).
import type { CommitStat } from "$lib/ipc";

// Mirrors the backend cap: commit_stats refuses more than 200 shas per call.
export const STATS_CHUNK_MAX = 200;
// Entries kept per repo. A stat is a few numbers, so this is a few MB at most.
export const STATS_LRU_CAP = 20_000;
// Quiet time after the last window change before git runs. A fling scroll then
// asks once, for where it stops, instead of once per row it crosses.
export const STATS_DEBOUNCE_MS = 120;

// Splits items into calls of at most `size`. A size below 1 would never end the
// loop, so it throws and names the value.
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunk size must be a positive integer, got ${size}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// The visible shas that still need git: not cached, not already in flight, each
// once, in window order. The in-flight check is what stops a scroll from asking
// for a commit a previous request is still fetching.
export function shasToFetch(
  visible: readonly string[],
  cached: ReadonlyMap<string, CommitStat>,
  inflight: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sha of visible) {
    if (seen.has(sha) || cached.has(sha) || inflight.has(sha)) continue;
    seen.add(sha);
    out.push(sha);
  }
  return out;
}

// Moves the visible entries to the newest end of the Map, so eviction drops
// rows the user scrolled away from. Map reads do not reorder, so the touch is
// explicit. Keys not in the map are skipped, not inserted.
export function lruTouch<V>(map: Map<string, V>, keys: readonly string[]): void {
  for (const key of keys) {
    if (!map.has(key)) continue;
    const entry = map.get(key) as V;
    map.delete(key);
    map.set(key, entry);
  }
}

// Inserts at the newest end, then evicts from the oldest end until the size is
// within `cap`. A re-put key moves to the newest end like a fresh one.
export function lruPut<V>(map: Map<string, V>, key: string, value: V, cap: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > cap) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}

// The git call the cache depends on. The app passes ipc.commitStats; tests pass
// a named fake.
export type StatsFetcher = (repo: string, shas: string[]) => Promise<CommitStat[]>;

export interface CommitStatCacheOptions {
  fetchStats: StatsFetcher;
  // Runs after each batch is stored, so the view can repaint.
  onLanded: () => void;
  // Failed batches are reported here and never thrown: a bad batch must not break the graph.
  warn: (msg: string) => void;
  debounceMs?: number;
  cap?: number;
}

interface RepoStats {
  cached: Map<string, CommitStat>;
  inflight: Set<string>;
}

// Holds stats per repo path, so switching repos needs no invalidation: a commit's
// stats never change, and each repo keeps its own entries.
export class CommitStatCache {
  private readonly fetchStats: StatsFetcher;
  private readonly onLanded: () => void;
  private readonly warn: (msg: string) => void;
  private readonly debounceMs: number;
  private readonly cap: number;
  private readonly repos = new Map<string, RepoStats>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { repo: string; visible: string[] } | null = null;

  constructor(opts: CommitStatCacheOptions) {
    this.fetchStats = opts.fetchStats;
    this.onLanded = opts.onLanded;
    this.warn = opts.warn;
    this.debounceMs = opts.debounceMs ?? STATS_DEBOUNCE_MS;
    this.cap = opts.cap ?? STATS_LRU_CAP;
  }

  // Replaces any pending request, so only the window the user rests on is fetched.
  request(repo: string, visible: readonly string[]): void {
    this.pending = { repo, visible: [...visible] };
    this.clearTimer();
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  // Drops a pending request. Called while the column is hidden, so nothing runs for it.
  cancel(): void {
    this.clearTimer();
    this.pending = null;
  }

  get(repo: string, sha: string): CommitStat | undefined {
    return this.repos.get(repo)?.cached.get(sha);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private flush(): void {
    this.timer = null;
    const req = this.pending;
    this.pending = null;
    if (!req) return;
    const state = this.stateFor(req.repo);
    lruTouch(state.cached, req.visible);
    const missing = shasToFetch(req.visible, state.cached, state.inflight);
    for (const part of chunk(missing, STATS_CHUNK_MAX)) void this.load(req.repo, state, part);
  }

  // Marks the shas in flight before the call starts, so a request made while it
  // runs skips them. Failures clear the marks without caching, so a later
  // window change asks again.
  private load(repo: string, state: RepoStats, part: string[]): Promise<void> {
    for (const sha of part) state.inflight.add(sha);
    return Promise.resolve()
      .then(() => this.fetchStats(repo, part))
      .then((stats) => this.store(state, stats))
      .catch((err: unknown) => this.warn(`commit stats for ${part.length} commits failed: ${String(err)}`))
      .finally(() => { for (const sha of part) state.inflight.delete(sha); });
  }

  private store(state: RepoStats, stats: readonly CommitStat[]): void {
    for (const stat of stats) lruPut(state.cached, stat.sha, stat, this.cap);
    this.onLanded();
  }

  private stateFor(repo: string): RepoStats {
    const existing = this.repos.get(repo);
    if (existing) return existing;
    const created: RepoStats = { cached: new Map(), inflight: new Set() };
    this.repos.set(repo, created);
    return created;
  }
}
