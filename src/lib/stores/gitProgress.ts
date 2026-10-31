import { get, writable } from "svelte/store";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Live progress of fetch/pull/push/clone, fed by the `git-progress` events the
// backend sends (contract: docs/specs/git-progress.md). The pure functions at
// the top are what the tests cover; the store and listener sit below them.

export type GitOpName = "fetch" | "pull" | "push" | "clone";

export interface GitProgressEvent {
  repo: string;
  op: GitOpName;
  phase: string | null;
  percent: number | null;
  done: boolean;
}

export interface RepoProgress {
  op: GitOpName;
  phase: string | null;
  percent: number | null;
  done: boolean;
}

// One entry per repo path. A repo runs one op at a time from the user's side;
// when two overlap (auto-fetch and a manual fetch), the newest one is shown.
export type ProgressMap = Record<string, RepoProgress>;

export const PROGRESS_EVENT = "git-progress";

// How long a finished op stays visible, so the bar reaches its end and the
// user can read the outcome before the pill disappears.
export const DONE_VISIBLE_MS = 1500;

const VERBS: Record<GitOpName, string> = {
  fetch: "Fetching",
  pull: "Pulling",
  push: "Pushing",
  clone: "Cloning",
};

// "finished", not "done": the event does not say whether git succeeded, and
// failures are already reported by the error toast.
const FINISHED: Record<GitOpName, string> = {
  fetch: "Fetch finished",
  pull: "Pull finished",
  push: "Push finished",
  clone: "Clone finished",
};

/** Next state after one event. A new op replaces the entry; a done event only applies to the op that is running. */
export function applyProgressEvent(map: ProgressMap, ev: GitProgressEvent): ProgressMap {
  if (!ev.done) {
    return { ...map, [ev.repo]: { op: ev.op, phase: ev.phase, percent: ev.percent, done: false } };
  }
  const current = map[ev.repo];
  // A done event for an op that is not the one shown (auto-fetch finishing
  // during a push) must not hide the push.
  if (!current || current.op !== ev.op) return map;
  return { ...map, [ev.repo]: { ...current, done: true } };
}

/** Removes a finished entry, but only if it still belongs to `op`. */
export function clearFinished(map: ProgressMap, repo: string, op: GitOpName): ProgressMap {
  const entry = map[repo];
  if (!entry || !entry.done || entry.op !== op) return map;
  const next: ProgressMap = { ...map };
  delete next[repo];
  return next;
}

/** The entry for the current repo; failing that, a clone in progress (the repo it targets is not open yet). */
export function pickProgressForRepo(map: ProgressMap, repo: string | null): RepoProgress | null {
  if (repo && map[repo]) return map[repo];
  for (const entry of Object.values(map)) {
    if (entry.op === "clone") return entry;
  }
  return null;
}

export function progressLabel(p: RepoProgress): string {
  if (p.done) return FINISHED[p.op];
  const phase = p.phase ? ` ${p.phase}` : "";
  const percent = p.percent !== null ? ` ${p.percent}%` : "";
  return `${VERBS[p.op]}…${phase}${percent}`;
}

/** 0 to 1 for the thin bar, or null when git has not reported a percentage (the bar then animates). */
export function progressFraction(p: RepoProgress): number | null {
  if (p.done) return 1;
  return p.percent === null ? null : p.percent / 100;
}

export const gitProgress = writable<ProgressMap>({});

const clearTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelClear(repo: string): void {
  const timer = clearTimers.get(repo);
  if (timer === undefined) return;
  clearTimeout(timer);
  clearTimers.delete(repo);
}

function scheduleClear(repo: string, op: GitOpName): void {
  cancelClear(repo);
  const timer = setTimeout(() => {
    clearTimers.delete(repo);
    gitProgress.update((m) => clearFinished(m, repo, op));
  }, DONE_VISIBLE_MS);
  clearTimers.set(repo, timer);
}

function handleEvent(ev: GitProgressEvent): void {
  if (!ev.done) {
    cancelClear(ev.repo);
    gitProgress.update((m) => applyProgressEvent(m, ev));
    return;
  }
  const before = get(gitProgress);
  const next = applyProgressEvent(before, ev);
  // An ignored done event (another op's) must not restart the timer of the op shown.
  if (next === before) return;
  gitProgress.set(next);
  scheduleClear(ev.repo, ev.op);
}

let listening: Promise<UnlistenFn> | null = null;

/**
 * Subscribes once to `git-progress`; later calls return the same subscription.
 * Outside Tauri (plain browser dev) there is no event bus, so this resolves
 * to a no-op instead of rejecting.
 */
export function startGitProgress(): Promise<UnlistenFn> {
  if (listening) return listening;
  listening = listen<GitProgressEvent>(PROGRESS_EVENT, (e) => handleEvent(e.payload))
    .catch((): UnlistenFn => () => {});
  return listening;
}
