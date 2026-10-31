import { writable, derived, get } from "svelte/store";
import type {
  GraphPage, CommitRef, StatusEntry, StashEntry,
  Remote, RecentRepoDto, OperationState, Worktree,
} from "$lib/ipc";
import { hiddenRefs, soloRefs } from "$lib/stores/graphFilter";

export interface RepoTab {
  id: string;
  path: string; // empty string for the synthetic "new tab"
  name: string;
  kind?: "repo" | "newtab";
  graph: GraphPage | null;
  status: StatusEntry[];
  stashes: StashEntry[];
  remotes: Remote[];
  worktrees: Worktree[];
  opState: OperationState | null;
  selectedSha: string | null;
}

export const NEW_TAB_ID = "__newtab__";

export function newTabStub(): RepoTab {
  return {
    id: NEW_TAB_ID, path: "", name: "New Tab", kind: "newtab",
    graph: null, status: [], stashes: [], remotes: [], worktrees: [],
    opState: null, selectedSha: null,
  };
}

export const WIP_SHA = "__WIP__";

export const tabs = writable<RepoTab[]>([]);
export const activeTabId = writable<string | null>(null);
export const recent = writable<RecentRepoDto[]>([]);
export const errorMessage = writable<string | null>(null);

export const activeTab = derived(
  [tabs, activeTabId],
  ([$tabs, $id]) => $tabs.find((t) => t.id === $id) ?? null,
);

export const currentRepo = derived(activeTab, ($t) => $t?.path ?? null);
export const graph = derived(activeTab, ($t) => $t?.graph ?? null);
export const status = derived(activeTab, ($t) => $t?.status ?? []);
export const stashes = derived(activeTab, ($t) => $t?.stashes ?? []);
export const remotes = derived(activeTab, ($t) => $t?.remotes ?? []);
export const worktrees = derived(activeTab, ($t) => $t?.worktrees ?? []);
export const opState = derived(activeTab, ($t) => $t?.opState ?? null);

export const selectedSha = {
  subscribe: derived(activeTab, ($t) => $t?.selectedSha ?? null).subscribe,
  set: (sha: string | null) => updateActive((t) => ({ ...t, selectedSha: sha })),
};

// Refs after applying the user's hide/solo filter.
// - Hide drops a single ref (badges + commits reachable only through it).
// - Solo (multi) collapses the view to a chosen SET of refs: only those
//   refs' badges are shown and only their combined history is reachable.
//   HEAD/stash are NOT auto-kept under solo — the user explicitly asked
//   for "just these branches."
// - Without solo, HEAD/stash bypass hide so the "you are here" anchor
//   and the stash drawer never disappear unintentionally.
export const visibleRefs = derived(
  [graph, hiddenRefs, soloRefs],
  ([$graph, $hidden, $solo]) => {
    if (!$graph) return [];
    if ($solo.size > 0) return $graph.refs.filter((r) => $solo.has(r.name));
    return $graph.refs.filter((r) => {
      if (r.kind === "head" || r.kind === "stash") return true;
      return !$hidden.has(r.name);
    });
  },
);

export const refsByCommit = derived(visibleRefs, ($refs) => {
  const map = new Map<string, CommitRef[]>();
  for (const r of $refs) {
    const arr = map.get(r.target_sha) ?? [];
    arr.push(r);
    map.set(r.target_sha, arr);
  }
  return map;
});

// SHAs reachable from any visible ref. Used by GraphCanvas to drop rows
// that would otherwise dangle when their only ref is filtered out (e.g.
// a remote-only branch like `origin/gh-pages` whose tip and history
// aren't on any other branch). When no filter is active, this returns
// `null` and consumers fall back to showing every node — saves the BFS
// in the common case.
export const reachableShas = derived(
  [graph, visibleRefs, hiddenRefs, soloRefs],
  ([$graph, $refs, $hidden, $solo]) => {
    if (!$graph) return null;
    if ($hidden.size === 0 && $solo.size === 0) return null; // no filter
    const parentsBy = new Map<string, string[]>();
    for (const n of $graph.nodes) parentsBy.set(n.sha, n.parents);
    const reachable = new Set<string>();
    const stack: string[] = [];
    // Under solo, HEAD does NOT seed the walk — the user wants only the
    // soloed branches' history visible. Without solo, HEAD always seeds
    // so the "you are here" anchor never vanishes when the user has
    // only hidden a few unrelated branches.
    if ($solo.size === 0 && $graph.head_sha) stack.push($graph.head_sha);
    for (const r of $refs) stack.push(r.target_sha);
    while (stack.length) {
      const sha = stack.pop()!;
      if (reachable.has(sha)) continue;
      reachable.add(sha);
      const ps = parentsBy.get(sha);
      if (ps) for (const p of ps) if (!reachable.has(p)) stack.push(p);
    }
    return reachable;
  },
);

// `git stash` produces helper commits ("index on <branch>: …" / "untracked
// files on <branch>: …") as extra parents of the real stash commit. They
// clutter the graph and GitKraken hides them, so we do too.
function isStashHelper(subject: string): boolean {
  return /^(?:index|untracked files)\s+on\s+\S/i.test(subject);
}

// The graph nodes ACTUALLY rendered: stash-helper commits dropped and, when a
// hide/solo filter is active, commits unreachable from any visible ref removed.
// Single source of truth shared by GraphCanvas (paint), keyboard navigation
// (+page moveGraphSelection) and commit search (graphSearch). Before this they
// each walked the raw `graph.nodes`, so arrow-nav and search could target rows
// that aren't drawn (stash helpers, filtered-out commits), then silently fail
// to scroll. (audit 2026-05)
export const visibleGraphNodes = derived(
  [graph, reachableShas],
  ([$graph, $reachable]) => {
    const all = ($graph?.nodes ?? []).filter((n) => !isStashHelper(n.subject));
    if (!$reachable) return all;
    return all.filter((n) => n.sha === WIP_SHA || $reachable.has(n.sha));
  },
);

// For each commit SHA, the branch ref(s) the commit "belongs to" — i.e.
// branches whose FIRST-PARENT chain from tip reaches the commit. This
// matches the user's mental model of "which branch was this commit made
// on" much more closely than `git branch --contains`, which lists every
// branch that has the commit anywhere in its ancestry (so a commit on
// `main` shows up on every feature branch forked off later).
//
// First-parent walk: when traversing a merge commit, keep going through
// `parents[0]` only (the side the merge was made INTO). The other parent
// is the merged branch's history, which we credit to its own tip's walk.
export const containingByCommit = derived(graph, ($graph) => {
  const map = new Map<string, Set<string>>();
  if (!$graph) return map;
  const parentsBy = new Map<string, string[]>();
  for (const n of $graph.nodes) parentsBy.set(n.sha, n.parents);
  const branchTips = $graph.refs.filter(
    (r) => r.kind === "localbranch" || r.kind === "remotebranch",
  );
  for (const tip of branchTips) {
    let cur: string | undefined = tip.target_sha;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const set = map.get(cur) ?? new Set<string>();
      set.add(tip.name);
      map.set(cur, set);
      const ps = parentsBy.get(cur);
      cur = ps && ps.length > 0 ? ps[0] : undefined;
    }
  }
  return map;
});

export const localBranches = derived(graph, ($g) =>
  $g ? $g.refs.filter((r) => r.kind === "localbranch") : []
);
export const remoteBranches = derived(graph, ($g) =>
  $g ? $g.refs.filter((r) => r.kind === "remotebranch") : []
);
export const tagsList = derived(graph, ($g) =>
  $g ? $g.refs.filter((r) => r.kind === "tag") : []
);

/** Replaces the active tab with `fn(tab)`. No-op when no tab is active.
 * Example: `updateActive((t) => ({ ...t, selectedSha: sha }))` */
export function updateActive(fn: (t: RepoTab) => RepoTab): void {
  const id = get(activeTabId);
  if (!id) return;
  tabs.update((arr) => arr.map((t) => (t.id === id ? fn(t) : t)));
}

/** Replaces the tab with `id` by `fn(tab)`; other tabs are left untouched.
 * Example: `updateTab(id, (t) => ({ ...t, status: next }))` */
export function updateTab(id: string, fn: (t: RepoTab) => RepoTab): void {
  tabs.update((arr) => arr.map((t) => (t.id === id ? fn(t) : t)));
}

/** Display name of a repo tab: the last path segment (`C:\\work\\app` -> `app`). */
export function tabName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Key used to compare repo paths: slashes unified, trailing slashes dropped,
 * lowercased, so `C:\\Work\\App\\` and `c:/work/app` are the same repo. */
export function normTabPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** True when two repo paths name the same folder (see `normTabPath`).
 * Example: `samePath(t.path, opened.path)` */
export function samePath(a: string, b: string): boolean {
  return normTabPath(a) === normTabPath(b);
}
