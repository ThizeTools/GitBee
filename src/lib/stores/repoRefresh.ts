import { writable, get } from "svelte/store";
import type { GraphPage } from "$lib/ipc";
import { ipc } from "$lib/ipc";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { mergeScope, parseScope, type RefreshScope } from "$lib/stores/refreshScope";
import { busy } from "$lib/stores/busy";
import {
  tabs, activeTab, errorMessage, updateTab, type RepoTab,
} from "$lib/stores/repoState";

// Bumped after every completed refresh, even when the status list is identical.
// An already-modified file edited again keeps the same status entry, so the
// working-tree diff panel keys on this instead of `status`. See docs/specs/repo-refresh.md.
export const worktreeTick = writable<number>(0);

// Commits per graph page; each "load more" grows a tab's limit by this much.
// See docs/specs/graph-loading.md.
export const GRAPH_PAGE = 2000;
// Tab id -> commit limit. Tabs without an entry use GRAPH_PAGE.
const graphLimits = new Map<string, number>();

function graphLimitFor(tabId: string): number {
  return graphLimits.get(tabId) ?? GRAPH_PAGE;
}

/** Forgets a closed tab's commit limit so the map does not grow with every tab ever opened.
 * Example: `closeTab → forgetGraphLimit(id)` */
export function forgetGraphLimit(tabId: string): void {
  graphLimits.delete(tabId);
}

let unlistenChange: UnlistenFn | null = null;

// `silent`: skip toggling the global `busy` flag so the loading veil
// doesn't flash. Used for watcher-driven refreshes — those happen
// continuously in the background and the user didn't ask for them, so
// covering the UI with a spinner every time a file mtime changes is
// jarring. Foreground actions (pull, push, checkout, …) still pass
// silent=false so the user gets the usual feedback.
// At most one load runs at a time; calls made during a run coalesce into
// ONE follow-up run that starts after it (silent only if every coalesced
// caller asked for silent), so a caller awaiting this after an action
// always sees data loaded after its call. Overlapping watcher / focus /
// action refreshes used to run 10 git processes each, in parallel.
// `scope` decides how much is reloaded: "status" only `git status`, "full"
// everything. Coalesced callers merge to the widest scope any of them asked for.
let refreshRunning: Promise<void> | null = null;
let refreshFollowUp: Promise<void> | null = null;
let followUpSilent = true;
let followUpScope: RefreshScope = "status";

export function refreshActive(opts: { silent?: boolean; scope?: RefreshScope } = {}): Promise<void> {
  const silent = opts.silent === true;
  const scope = opts.scope ?? "full";
  if (!refreshRunning) return startRefresh(silent, scope);
  followUpSilent = followUpSilent && silent;
  followUpScope = mergeScope(followUpScope, scope);
  if (!refreshFollowUp) {
    refreshFollowUp = refreshRunning.then(() => {
      const s = followUpSilent;
      const sc = followUpScope;
      refreshFollowUp = null;
      followUpSilent = true;
      followUpScope = "status";
      return startRefresh(s, sc);
    });
  }
  return refreshFollowUp;
}

function startRefresh(silent: boolean, scope: RefreshScope): Promise<void> {
  const run: Promise<void> = loadActiveTab(silent, scope).finally(() => {
    if (refreshRunning === run) refreshRunning = null;
  });
  refreshRunning = run;
  return run;
}

type TabSnapshot = Pick<RepoTab, "graph" | "status" | "stashes" | "remotes" | "worktrees" | "opState">;

/** Whether one snapshot field differs from the stored value. The graph is
 * compared by fingerprint: the fingerprint decides the graph, and stringifying
 * 2000+ nodes on every refresh was the main idle cost. Other keys keep the
 * JSON compare. */
function fieldChanged(key: keyof TabSnapshot, a: unknown, b: unknown): boolean {
  if (key === "graph") return graphChanged(a as GraphPage | null, b as GraphPage | null);
  return JSON.stringify(a) !== JSON.stringify(b);
}

function graphChanged(a: GraphPage | null, b: GraphPage | null): boolean {
  if ((a === null) !== (b === null)) return true;
  return a?.fingerprint !== b?.fingerprint;
}

/** Returns `cur` itself when nothing changed, else a copy with only the
 * changed fields replaced, so an idle refresh doesn't touch the stores.
 * Example: `const next = withChangedFields(tab, fresh); if (next !== tab) ...` */
function withChangedFields(cur: RepoTab, next: TabSnapshot): RepoTab {
  const changed: Partial<TabSnapshot> = {};
  for (const key of Object.keys(next) as (keyof TabSnapshot)[]) {
    if (fieldChanged(key, cur[key], next[key])) changed[key] = next[key] as never;
  }
  return Object.keys(changed).length ? { ...cur, ...changed } : cur;
}

/** Loads everything a full refresh shows for `t`. When the graph fingerprint
 * is unchanged the backend skipped `git log`, so the caller keeps `t.graph`. */
async function fetchFullSnapshot(t: RepoTab): Promise<TabSnapshot> {
  const [g, st, sl, rl, wt, op] = await Promise.all([
    ipc.graphLoad(t.path, graphLimitFor(t.id), t.graph?.fingerprint ?? null),
    ipc.statusLoad(t.path).catch(() => []),
    ipc.stashList(t.path).catch(() => []),
    ipc.remoteList(t.path).catch(() => []),
    ipc.worktreeList(t.path).catch(() => []),
    ipc.opState(t.path).catch(() => null),
  ]);
  return {
    graph: g.unchanged ? t.graph : g,
    status: st, stashes: sl, remotes: rl, worktrees: wt, opState: op,
  };
}

/** Reloads only `git status` for `t`. Returns false when that call fails,
 * leaving the tab untouched. */
async function loadStatusOnly(t: RepoTab): Promise<boolean> {
  const st = await ipc.statusLoad(t.path).catch(() => null);
  if (st === null) return false;
  const cur = get(tabs).find((x) => x.id === t.id);
  if (cur && fieldChanged("status", cur.status, st)) {
    updateTab(t.id, (x) => ({ ...x, status: st }));
  }
  return true;
}

async function loadFullTab(t: RepoTab): Promise<void> {
  const snapshot = await fetchFullSnapshot(t);
  const cur = get(tabs).find((x) => x.id === t.id);
  if (!cur) return;
  const next = withChangedFields(cur, snapshot);
  if (next !== cur) updateTab(t.id, () => next);
}

async function loadActiveTab(silent: boolean, scope: RefreshScope): Promise<void> {
  const t = get(activeTab);
  if (!t || t.kind === "newtab" || !t.path) return;
  if (scope === "status") {
    if (await loadStatusOnly(t)) worktreeTick.update((n) => n + 1);
    return;
  }
  if (!silent) busy.set(true);
  try {
    await loadFullTab(t);
    errorMessage.set(null);
    worktreeTick.update((n) => n + 1);
  } catch (e) {
    errorMessage.set(String(e));
  } finally {
    if (!silent) busy.set(false);
  }
}

// Set while a load-more is pending, so repeated scroll events don't stack limits.
let loadMorePending = false;

/** Grows the active tab's commit limit by one page and refreshes silently.
 * No-op while a previous load is pending or the graph has no older commits.
 * Example: `onScroll → if near bottom: void loadMoreCommits()` */
export async function loadMoreCommits(): Promise<void> {
  const t = get(activeTab);
  if (loadMorePending || t?.kind === "newtab" || !t?.graph?.has_more) return;
  loadMorePending = true;
  try {
    graphLimits.set(t.id, graphLimitFor(t.id) + GRAPH_PAGE);
    await refreshActive({ silent: true });
  } finally {
    loadMorePending = false;
  }
}

// Set while the window is unfocused and the backend watcher is stopped.
let watcherPaused = false;

/** Starts the backend watcher on `path` and listens for its `repo-changed`
 * events, replacing any listener from a previous repo. Example:
 * `await attachWatcher(opened.path)` */
export async function attachWatcher(path: string): Promise<void> {
  watcherPaused = false;
  if (unlistenChange) { unlistenChange(); unlistenChange = null; }
  await ipc.watcherStart(path);
  // The backend says whether git status alone is enough; a "full" burst
  // (refs, HEAD, stashes changed) needs the graph too.
  unlistenChange = await listen("repo-changed", (e) => {
    refreshActive({ silent: true, scope: parseScope(e.payload) });
  });
}

/** Drops the `repo-changed` listener and stops the backend watcher. Used when
 * no repo tab is shown (new-tab page, last tab closed), so nothing refreshes a
 * repo the user is no longer looking at. Example: `await stopWatcher()` */
export async function stopWatcher(): Promise<void> {
  if (unlistenChange) { unlistenChange(); unlistenChange = null; }
  await ipc.watcherStop().catch(() => {});
}

/** Stops the backend watcher but keeps the event listener, releasing the
 * OS directory handle on the repo while the window is in the background
 * (Windows reports it as "file in use by GitBee").
 * Example: `window.addEventListener("blur", () => void pauseWatcher())` */
export async function pauseWatcher(): Promise<void> {
  const t = get(activeTab);
  if (!t || t.kind === "newtab" || !t.path) return;
  watcherPaused = true;
  await ipc.watcherStop().catch(() => {});
}

/** Restarts the watcher after `pauseWatcher` and catches up with one
 * silent refresh. No-op when not paused.
 * Example: `window.addEventListener("focus", () => void resumeWatcher())` */
export async function resumeWatcher(): Promise<void> {
  if (!watcherPaused) return;
  watcherPaused = false;
  const t = get(activeTab);
  if (!t || t.kind === "newtab" || !t.path) return;
  await ipc.watcherStart(t.path).catch(() => {});
  await refreshActive({ silent: true });
}
