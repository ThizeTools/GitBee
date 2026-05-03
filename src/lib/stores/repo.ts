import { writable, derived, get } from "svelte/store";
import type {
  GraphPage, CommitRef, StatusEntry, StashEntry,
  Remote, RecentRepoDto, OperationState, Worktree,
} from "$lib/ipc";
import { ipc } from "$lib/ipc";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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
const STORAGE_TABS = "gkp.tabs.v1";
const STORAGE_ACTIVE = "gkp.tabs.active.v1";

export const tabs = writable<RepoTab[]>([]);
export const activeTabId = writable<string | null>(null);
export const recent = writable<RecentRepoDto[]>([]);
export const errorMessage = writable<string | null>(null);
export const busy = writable<boolean>(false);

// Debounced/smoothed view of `busy` for UI overlays. Falling edges (true →
// false) are delayed by BUSY_HIDE_DELAY ms so a quick succession of git
// operations doesn't flicker the loading veil on/off between them. Rising
// edges propagate immediately. Use this in components, not raw `busy`.
export const busyVisible = writable<boolean>(false);
const BUSY_HIDE_DELAY = 350;
let busyHideTimer: ReturnType<typeof setTimeout> | null = null;
busy.subscribe((b) => {
  if (b) {
    if (busyHideTimer) { clearTimeout(busyHideTimer); busyHideTimer = null; }
    busyVisible.set(true);
  } else {
    if (busyHideTimer) clearTimeout(busyHideTimer);
    busyHideTimer = setTimeout(() => {
      busyVisible.set(false);
      busyHideTimer = null;
    }, BUSY_HIDE_DELAY);
  }
});

let unlistenChange: UnlistenFn | null = null;

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

export const refsByCommit = derived(graph, ($graph) => {
  const map = new Map<string, CommitRef[]>();
  if (!$graph) return map;
  for (const r of $graph.refs) {
    const arr = map.get(r.target_sha) ?? [];
    arr.push(r);
    map.set(r.target_sha, arr);
  }
  return map;
});

// For each commit SHA, the set of branch refs whose history *contains* it.
// Cheap precompute over the loaded slice (newest→oldest with parent links):
// for each branch tip, walk parents and tag every commit reachable.
export const containingByCommit = derived(graph, ($graph) => {
  const map = new Map<string, Set<string>>();
  if (!$graph) return map;
  const parentsBy = new Map<string, string[]>();
  for (const n of $graph.nodes) parentsBy.set(n.sha, n.parents);
  const branchTips = $graph.refs.filter(
    (r) => r.kind === "localbranch" || r.kind === "remotebranch",
  );
  for (const tip of branchTips) {
    // BFS from the tip's commit through parent chain.
    const seen = new Set<string>();
    const stack = [tip.target_sha];
    while (stack.length) {
      const sha = stack.pop()!;
      if (seen.has(sha)) continue;
      seen.add(sha);
      const set = map.get(sha) ?? new Set<string>();
      set.add(tip.name);
      map.set(sha, set);
      const ps = parentsBy.get(sha);
      if (ps) for (const p of ps) if (!seen.has(p)) stack.push(p);
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

function updateActive(fn: (t: RepoTab) => RepoTab) {
  const id = get(activeTabId);
  if (!id) return;
  tabs.update((arr) => arr.map((t) => (t.id === id ? fn(t) : t)));
}

function updateTab(id: string, fn: (t: RepoTab) => RepoTab) {
  tabs.update((arr) => arr.map((t) => (t.id === id ? fn(t) : t)));
}

function tabName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export async function refreshActive() {
  const t = get(activeTab);
  if (!t || t.kind === "newtab" || !t.path) return;
  busy.set(true);
  try {
    const [g, st, sl, rl, wt, op] = await Promise.all([
      ipc.graphLoad(t.path),
      ipc.statusLoad(t.path).catch(() => []),
      ipc.stashList(t.path).catch(() => []),
      ipc.remoteList(t.path).catch(() => []),
      ipc.worktreeList(t.path).catch(() => []),
      ipc.opState(t.path).catch(() => null),
    ]);
    updateTab(t.id, (cur) => ({
      ...cur, graph: g, status: st, stashes: sl, remotes: rl, worktrees: wt, opState: op,
    }));
    errorMessage.set(null);
  } catch (e) {
    errorMessage.set(String(e));
  } finally {
    busy.set(false);
  }
}

async function attachWatcher(path: string) {
  if (unlistenChange) { unlistenChange(); unlistenChange = null; }
  await ipc.watcherStart(path);
  unlistenChange = await listen("repo-changed", () => { refreshActive(); });
}

export async function openRepo(path: string) {
  const existing = get(tabs).find((t) => t.path === path);
  if (existing) {
    await activateTab(existing.id);
    return;
  }
  busy.set(true);
  errorMessage.set(null);
  try {
    const opened = await ipc.repoOpen(path);
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newTab: RepoTab = {
      id, path: opened.path, name: tabName(opened.path),
      graph: null, status: [], stashes: [], remotes: [], worktrees: [],
      opState: null, selectedSha: null,
    };
    tabs.update((arr) => [...arr, newTab]);
    activeTabId.set(id);
    await attachWatcher(opened.path);
    await refreshActive();
    recent.set(await ipc.repoRecent(15));
    import("$lib/menus/refMenus").then((m) => m.refreshRemoteTags()).catch(() => {});
  } catch (e) {
    errorMessage.set(String(e));
  } finally {
    busy.set(false);
  }
}

export async function activateTab(id: string) {
  const t = get(tabs).find((x) => x.id === id);
  if (!t) return;
  activeTabId.set(id);
  if (t.kind === "newtab" || !t.path) {
    if (unlistenChange) { unlistenChange(); unlistenChange = null; }
    await ipc.watcherStop().catch(() => {});
    return;
  }
  // First-activation registration: tabs restored from disk are stubs with
  // no graph yet — register the repo with the backend before refreshing
  // so it shows up in recents and the SQLite cache.
  if (!t.graph) {
    try { await ipc.repoOpen(t.path); }
    catch (e) { errorMessage.set(String(e)); }
  }
  await attachWatcher(t.path);
  await refreshActive();
  // Warm caches that downstream menus rely on (#3 round 9: hide push when
  // tag exists on remote). Lazy-import to avoid a cycle.
  import("$lib/menus/refMenus").then((m) => m.refreshRemoteTags()).catch(() => {});
}

// reorder tabs (drag and drop). #8 — keep relative order of repo tabs.
export function moveTab(fromId: string, toId: string) {
  tabs.update((arr) => {
    const from = arr.findIndex((t) => t.id === fromId);
    const to = arr.findIndex((t) => t.id === toId);
    if (from < 0 || to < 0 || from === to) return arr;
    const next = arr.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  });
}

// Stack of recently closed tabs (for Ctrl+Shift+T reopen). Holds repo paths.
const closedStack: string[] = [];
const CLOSED_LIMIT = 20;

export async function closeTab(id: string) {
  const list = get(tabs);
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const closed = list[idx];
  if (closed.path) {
    closedStack.push(closed.path);
    if (closedStack.length > CLOSED_LIMIT) closedStack.shift();
  }
  const remaining = list.filter((t) => t.id !== id);
  tabs.set(remaining);
  if (get(activeTabId) === id) {
    if (remaining.length === 0) {
      activeTabId.set(null);
      if (unlistenChange) { unlistenChange(); unlistenChange = null; }
      await ipc.watcherStop().catch(() => {});
    } else {
      const fallback = remaining[Math.min(idx, remaining.length - 1)];
      await activateTab(fallback.id);
    }
  }
}

// #2 — pop the top of the closed-tab stack and reopen it.
export async function reopenLastClosedTab() {
  const path = closedStack.pop();
  if (!path) return;
  await openRepo(path);
}

// #2 — close everything except `id`.
export async function closeOtherTabs(id: string) {
  const list = get(tabs);
  const others = list.filter((t) => t.id !== id);
  for (const t of others) await closeTab(t.id);
}

// #2 — close every tab to the right of `id`.
export async function closeTabsToRight(id: string) {
  const list = get(tabs);
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const toClose = list.slice(idx + 1).map((t) => t.id);
  for (const tid of toClose) await closeTab(tid);
}

export async function refreshRecent() {
  try { recent.set(await ipc.repoRecent(15)); } catch { /* ignore */ }
}

/// Remove a repo from the Recents list. The repo on disk is untouched —
/// just the cache entry. UI updates optimistically so the row disappears
/// instantly; if the backend errors, refreshRecent() puts it back.
export async function forgetRepo(path: string) {
  recent.update((list) => list.filter((r) => r.path !== path));
  try { await ipc.repoForget(path); }
  catch { await refreshRecent(); }
}

export async function withBusy<T>(fn: () => Promise<T>): Promise<T | null> {
  busy.set(true);
  errorMessage.set(null);
  try {
    const r = await fn();
    await refreshActive();
    return r;
  } catch (e) {
    errorMessage.set(String(e));
    return null;
  } finally {
    busy.set(false);
  }
}

// Backwards-compat alias used in other components
export const refreshAll = refreshActive;

// --- Persistence ---
// Snapshot the saved state at module load BEFORE subscribing to writes,
// otherwise the initial empty `tabs` state would clobber the saved data.

const savedSnapshot: { paths: string[]; activePath: string } = (() => {
  if (typeof localStorage === "undefined") return { paths: [], activePath: "" };
  let paths: string[] = [];
  const raw = localStorage.getItem(STORAGE_TABS);
  if (raw) {
    try {
      const arr = JSON.parse(raw) as { path: string }[];
      paths = arr.map((x) => x.path).filter(Boolean);
    } catch { /* ignore */ }
  }
  const activePath = localStorage.getItem(STORAGE_ACTIVE) || "";
  return { paths, activePath };
})();

let persistEnabled = false;

function persist() {
  if (!persistEnabled || typeof localStorage === "undefined") return;
  const list = get(tabs).filter((t) => t.kind !== "newtab" && t.path).map((t) => ({ path: t.path }));
  localStorage.setItem(STORAGE_TABS, JSON.stringify(list));
  const id = get(activeTabId);
  const t = get(tabs).find((x) => x.id === id);
  localStorage.setItem(STORAGE_ACTIVE, t?.path ?? "");
}

tabs.subscribe(() => persist());
activeTabId.subscribe(() => persist());

// Lazy-restore: build tab stubs synchronously so the tab bar reflects the
// previous session immediately, then activate ONLY the saved active tab —
// inactive tabs stay unloaded (no git calls, no watcher, no flicker on the
// sidebar) until the user clicks them, the same way Chrome handles
// background tabs after restart.
export async function restoreTabs(): Promise<void> {
  const stubs: RepoTab[] = savedSnapshot.paths.map((path) => ({
    id: `tab-${Math.random().toString(36).slice(2, 9)}`,
    path,
    name: tabName(path),
    graph: null, status: [], stashes: [], remotes: [], worktrees: [],
    opState: null, selectedSha: null,
  }));
  // Always enable persistence after the restore attempt — even if activateTab
  // throws (e.g., a saved repo path is missing or the watcher fails to attach),
  // the user expects subsequent tab edits to be saved. Without try/finally, a
  // single broken saved repo would silently disable tab persistence for the
  // entire session.
  try {
    if (stubs.length > 0) {
      tabs.set(stubs);
      const active = stubs.find((t) => t.path === savedSnapshot.activePath) ?? stubs[0];
      await activateTab(active.id);
    }
  } finally {
    persistEnabled = true;
  }
}
