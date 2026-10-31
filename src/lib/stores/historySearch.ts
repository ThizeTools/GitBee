import { get, writable } from "svelte/store";
import { ipc } from "$lib/ipc";
import { activeTab, graph } from "$lib/stores/repoState";
import { loadMoreCommits } from "$lib/stores/repoRefresh";
import { graphScrollTarget } from "$lib/stores/graphscroll";
import {
  searchQuery, remoteHits, olderMatchShas, matchShas, currentMatchIdx,
} from "$lib/stores/graphSearch";
import {
  loadOlderUntil, shouldSearchRemote, TrailingDebounce, REMOTE_DEBOUNCE_MS,
  type OlderLoadDeps, type RemoteHits,
} from "$lib/graph/historySearch";

// Store wiring for search beyond the loaded graph. The rules are in
// $lib/graph/historySearch.ts; see docs/specs/history-search.md.

// True while "Show" loads older pages.
export const olderLoading = writable<boolean>(false);

// Bumped on every schedule and cancel. A backend response for an older bump is dropped.
let requestSeq = 0;
// Set by cancelHistorySearch and the Cancel button; the older-history loop stops at its next step.
let cancelRequested = false;

const browserTimers = {
  set: (callback: () => void, ms: number): unknown => setTimeout(callback, ms),
  clear: (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const searchDebounce = new TrailingDebounce(REMOTE_DEBOUNCE_MS, browserTimers);

/** Asks the backend for the commits matching `query` once typing pauses. Queries
 * under the minimum length clear the hits. Never blocks typing: the local match
 * list is already instant. Example: `$effect(() => scheduleHistorySearch($searchQuery))` */
export function scheduleHistorySearch(query: string): void {
  requestSeq++;
  searchDebounce.cancel();
  const q = query.trim();
  if (!shouldSearchRemote(q)) {
    remoteHits.set(null);
    return;
  }
  const seq = requestSeq;
  searchDebounce.schedule(() => void runRemoteSearch(q, seq));
}

/** Drops a pending search and stops an older-history load in progress. Called when
 * the query changes or the search bar closes. */
export function cancelHistorySearch(): void {
  requestSeq++;
  searchDebounce.cancel();
  cancelRequested = true;
}

/** Stops "Show" after its current page. The loaded pages stay loaded. */
export function cancelOlderLoad(): void {
  cancelRequested = true;
}

async function runRemoteSearch(q: string, seq: number): Promise<void> {
  const path = get(activeTab)?.path;
  if (!path) return;
  let shas: string[];
  try {
    shas = await ipc.graphSearch(path, q);
  } catch {
    // Best effort: the loaded matches keep working without the backend hits.
    return;
  }
  if (seq !== requestSeq) return;
  const hits: RemoteHits = { query: q, shas };
  remoteHits.set(hits);
}

/** Loads older history until the newest match that is not loaded yet is in the
 * graph, then jumps to it. Resolves with that sha, or null when it could not be
 * loaded (cancelled, or the match is still hidden by a filter).
 * Example: onClick → `await revealOlderMatch()` */
export async function revealOlderMatch(): Promise<string | null> {
  const target = get(olderMatchShas)[0] ?? null;
  if (target === null || get(olderLoading)) return null;
  cancelRequested = false;
  olderLoading.set(true);
  try {
    const loaded = await loadOlderUntil(target, olderLoadDeps());
    if (!loaded) return null;
    jumpTo(target);
    return target;
  } finally {
    olderLoading.set(false);
  }
}

function olderLoadDeps(): OlderLoadDeps {
  return {
    isLoaded: (sha) => (get(graph)?.nodes ?? []).some((n) => n.sha === sha),
    hasMore: () => get(graph)?.has_more === true,
    loadPage: () => loadMoreCommits(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    cancelled: () => cancelRequested,
  };
}

// Puts the cursor on the match and scrolls to it. A match a filter hides is not
// in the match list, so there is nothing to jump to.
function jumpTo(sha: string): void {
  const idx = get(matchShas).indexOf(sha);
  if (idx < 0) return;
  currentMatchIdx.set(idx);
  graphScrollTarget.set(sha);
}

// Hits belong to one repo. A tab switch re-runs the search for the open query.
let lastPath: string | null = null;
activeTab.subscribe((t) => {
  const path = t?.path || null;
  if (path === lastPath) return;
  lastPath = path;
  scheduleHistorySearch(get(searchQuery));
});
