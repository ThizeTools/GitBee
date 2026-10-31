import { writable, derived, get } from "svelte/store";
import { visibleGraphNodes, graph } from "$lib/stores/repo";
import type { GraphNode } from "$lib/ipc";
import {
  olderMatches, remoteShasFor, type RemoteHits,
} from "$lib/graph/historySearch";

// Open/closed state for the search bar above the graph. Toggled by
// Ctrl+F when the graph is focused; closing also clears the query so
// the highlight goes away when the user moves on.
export const searchOpen = writable<boolean>(false);
export const searchQuery = writable<string>("");
export const currentMatchIdx = writable<number>(0);

// Backend hits for the open query (`graph_search`, see docs/specs/history-search.md).
// They can name commits that are not loaded yet; those count as older matches.
// The store is keyed by query, so hits for an earlier query are ignored.
export const remoteHits = writable<RemoteHits | null>(null);

// SHAs of every commit that matches the current query, in graph order. Computed
// over the VISIBLE node set (same stash-helper + hide/solo filtering the canvas
// renders), not the raw slice, so Enter/F3 stepping never lands on a hidden row.
// Loaded commits match locally (instant) or through a backend hit. A hit that is
// not loaded yet is left out here; see olderMatchShas. Match across: 7+ char SHA
// prefix, commit subject, author name, author email, case-insensitive substring.
// (audit 2026-05)
export const matchShas = derived(
  [visibleGraphNodes, searchQuery, remoteHits],
  ([$nodes, $query, $remote]) => {
    const q = $query.trim().toLowerCase();
    if (!q) return [] as string[];
    const remote = new Set(remoteShasFor($remote, $query));
    const out: string[] = [];
    for (const n of $nodes) {
      if (remote.has(n.sha) || matchesNode(n, q)) out.push(n.sha);
    }
    return out;
  },
);

// Backend hits whose commit is not in the loaded graph, newest first. The count
// behind "N more matches in older history"; the first one is what "Show" loads to.
export const olderMatchShas = derived(
  [graph, searchQuery, remoteHits],
  ([$graph, $query, $remote]) => {
    const shas = remoteShasFor($remote, $query);
    if (shas.length === 0 || !$graph) return [] as string[];
    return olderMatches(shas, new Set($graph.nodes.map((n) => n.sha)));
  },
);

export const matchSet = derived(matchShas, ($shas) => new Set($shas));

function matchesNode(n: GraphNode, q: string): boolean {
  if (n.sha.toLowerCase().startsWith(q)) return true;
  if (n.subject.toLowerCase().includes(q)) return true;
  if (n.author_name.toLowerCase().includes(q)) return true;
  if (n.author_email.toLowerCase().includes(q)) return true;
  return false;
}

// Reset the navigation cursor whenever the match set changes (e.g. user
// types another character). Without this, currentMatchIdx could point
// past the end of the new array and "next" would silently no-op.
matchShas.subscribe((shas) => {
  const cur = get(currentMatchIdx);
  if (cur >= shas.length) currentMatchIdx.set(0);
});

export function openSearch(): void {
  searchOpen.set(true);
}

export function closeSearch(): void {
  searchOpen.set(false);
  searchQuery.set("");
  currentMatchIdx.set(0);
  remoteHits.set(null);
}

export function nextMatch(): string | null {
  const shas = get(matchShas);
  if (shas.length === 0) return null;
  const cur = get(currentMatchIdx);
  const next = (cur + 1) % shas.length;
  currentMatchIdx.set(next);
  return shas[next];
}

export function prevMatch(): string | null {
  const shas = get(matchShas);
  if (shas.length === 0) return null;
  const cur = get(currentMatchIdx);
  const next = (cur - 1 + shas.length) % shas.length;
  currentMatchIdx.set(next);
  return shas[next];
}

// Returns the sha at the current cursor (without advancing it). Useful
// for the search bar to show "match 3/12" labels.
export function currentSha(): string | null {
  const shas = get(matchShas);
  const cur = get(currentMatchIdx);
  return shas[cur] ?? null;
}
