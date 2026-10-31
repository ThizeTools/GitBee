// App-wide Changes-column cache: one CommitStatCache wired to the commit_stats
// IPC call and to a version store the graph reads, so changes cells repaint when
// a batch lands. The logic lives in graph/commitStatsCore.ts; this file is the wiring.
import { writable } from "svelte/store";
import { ipc, type CommitStat } from "$lib/ipc";
import { logAppend } from "$lib/stores/logs";
import { CommitStatCache } from "$lib/graph/commitStatsCore";

// Bumped whenever a batch lands. The graph reads it through statsLookup, so the
// cells repaint without the cache copying its maps.
export const statsTick = writable<number>(0);

const cache = new CommitStatCache({
  fetchStats: (repo, shas) => ipc.commitStats(repo, shas),
  onLanded: () => statsTick.update((n) => n + 1),
  warn: (msg) => logAppend("warn", msg),
});

export interface StatsLookup {
  readonly version: number;
  get(sha: string): CommitStat | undefined;
}

// `version` is part of the result on purpose. A new batch yields a new object,
// which is the signal a $derived needs to re-run the template reads.
export function statsLookup(repo: string | null, version: number): StatsLookup {
  return {
    version,
    get: (sha) => (repo === null ? undefined : cache.get(repo, sha)),
  };
}

export function requestVisibleStats(repo: string, visible: readonly string[]): void {
  cache.request(repo, visible);
}

export function cancelStatsRequest(): void {
  cache.cancel();
}
