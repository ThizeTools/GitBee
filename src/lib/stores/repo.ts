import { get } from "svelte/store";
import { ipc } from "$lib/ipc";
import { showingNewTab } from "$lib/stores/newtab";
import { showingInfo } from "$lib/stores/info";
import { busy } from "$lib/stores/busy";
import {
  tabs, activeTabId, recent, errorMessage, tabName, samePath, normTabPath,
  type RepoTab,
} from "$lib/stores/repoState";
import {
  refreshActive, attachWatcher, stopWatcher, forgetGraphLimit,
} from "$lib/stores/repoRefresh";

// Repo actions (open, close, activate, persist) over the state in repoState,
// busy and repoRefresh. The three layers are re-exported here so every
// existing `$lib/stores/repo` import keeps working.
export * from "$lib/stores/repoState";
export * from "$lib/stores/busy";
export * from "$lib/stores/repoRefresh";

const STORAGE_TABS = "gkp.tabs.v1";
const STORAGE_ACTIVE = "gkp.tabs.active.v1";

/// Stale recents auto-prune: when the backend rejects a path with
/// "invalid repository path" (folder deleted, USB unplugged, project
/// renamed), drop it from the cache instead of leaving a dead row in
/// the Recents list that re-errors on every click.
function isStalePathError(e: unknown): boolean {
  const msg = String(e);
  return msg.includes("invalid repository path")
      || msg.includes("InvalidRepoPath")
      || msg.includes("is not a git repository");
}

export async function openRepo(path: string) {
  const existing = get(tabs).find((t) => samePath(t.path, path));
  if (existing) {
    await activateTab(existing.id);
    return;
  }
  busy.set(true);
  errorMessage.set(null);
  try {
    const opened = await ipc.repoOpen(path);
    const dup = get(tabs).find((t) => samePath(t.path, opened.path));
    if (dup) {
      await activateTab(dup.id);
      return;
    }
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
    if (isStalePathError(e)) {
      // Drop the dead recent silently and surface a friendlier message.
      await forgetRepo(path);
      errorMessage.set(`Removed missing folder from Recents: ${path}`);
    } else {
      errorMessage.set(String(e));
    }
  } finally {
    busy.set(false);
  }
}

export async function activateTab(id: string) {
  const t = get(tabs).find((x) => x.id === id);
  if (!t) return;
  activeTabId.set(id);
  if (t.kind === "newtab" || !t.path) {
    await stopWatcher();
    return;
  }
  // First-activation registration: tabs restored from disk are stubs with
  // no graph yet — register the repo with the backend before refreshing
  // so it shows up in recents and the SQLite cache.
  if (!t.graph) {
    try { await ipc.repoOpen(t.path); }
    catch (e) {
      if (isStalePathError(e)) {
        // Restored stub tab pointing at a folder that no longer exists —
        // close the dead tab and prune Recents instead of repeatedly
        // erroring on every click.
        await forgetRepo(t.path);
        await closeTab(t.id);
        errorMessage.set(`Removed missing folder from Recents: ${t.path}`);
        return;
      }
      errorMessage.set(String(e));
    }
  }
  await attachWatcher(t.path);
  // Veil only on the tab's first load; re-activating a loaded tab
  // refreshes in the background.
  await refreshActive({ silent: !!t.graph });
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
  forgetGraphLimit(id);
  const remaining = list.filter((t) => t.id !== id);
  tabs.set(remaining);
  if (remaining.length === 0) {
    activeTabId.set(null);
    showingNewTab.set(true);
    showingInfo.set(false);
    await stopWatcher();
  } else if (get(activeTabId) === id) {
    const fallback = remaining[Math.min(idx, remaining.length - 1)];
    await activateTab(fallback.id);
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
  const seen = new Set<string>();
  const uniquePaths = savedSnapshot.paths.filter((p) => {
    const k = normTabPath(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const stubs: RepoTab[] = uniquePaths.map((path) => ({
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
      const active = stubs.find((t) => samePath(t.path, savedSnapshot.activePath)) ?? stubs[0];
      await activateTab(active.id);
    }
  } finally {
    persistEnabled = true;
  }
}
