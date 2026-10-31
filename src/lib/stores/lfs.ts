// Git LFS state of the open repos. Status (is git-lfs installed, does the repo
// use it) loads once per repo tab. Which shown paths are LFS files is asked in
// debounced batches and cached per repo. Spec: docs/specs/git-lfs.md.

import { derived, get, writable, type Readable } from "svelte/store";
import { ipc, type LfsInfo } from "$lib/ipc";
import { currentRepo } from "$lib/stores/repoState";
import { logAppend } from "$lib/stores/logs";
import { queuePaths, takeReadyBatches, type PathBatch, type PendingPaths } from "$lib/lfs/pending";

/** Quiet time before a batch of path checks goes out. */
export const LFS_DEBOUNCE_MS = 150;

/** Per path: true = an LFS file, false = not. A missing key means "not asked yet". */
export type LfsFlags = Record<string, boolean>;

const NO_FLAGS: LfsFlags = {};

const statusByRepo = writable<Record<string, LfsInfo>>({});
const flagsByRepo = writable<Record<string, LfsFlags>>({});
/** Every path ever asked about, per repo. A refresh asks them again. */
const askedByRepo = new Map<string, Set<string>>();
const pending: PendingPaths = new Map();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Status of the open repo, or null while it loads or when no repo is open. */
export const currentLfs: Readable<LfsInfo | null> = derived(
  [currentRepo, statusByRepo],
  ([$repo, $all]) => ($repo !== null && $all[$repo] !== undefined ? $all[$repo] : null),
);

/** LFS flags of the open repo's paths. */
export const currentLfsFlags: Readable<LfsFlags> = derived(
  [currentRepo, flagsByRepo],
  ([$repo, $all]) => ($repo !== null ? ($all[$repo] ?? NO_FLAGS) : NO_FLAGS),
);

// WHY subscribe here: a repo tab that becomes active needs its status once,
// whichever component shows it first. Later activations hit the cache.
currentRepo.subscribe((repo) => {
  if (repo !== null && get(statusByRepo)[repo] === undefined) void loadStatus(repo);
});

async function loadStatus(repo: string): Promise<void> {
  try {
    const info = await ipc.lfsStatus(repo);
    statusByRepo.update((all) => ({ ...all, [repo]: info }));
  } catch (e) {
    logAppend("warn", `git lfs status for ${repo} failed: ${e}`);
    return;
  }
  if (pending.has(repo)) schedule();
}

/**
 * Asks which of `paths` are LFS files in `repo`. Paths already answered are
 * skipped. The answer arrives a moment later through currentLfsFlags.
 */
export function requestLfsPaths(repo: string, paths: readonly string[]): void {
  const asked = askedByRepo.get(repo) ?? new Set<string>();
  askedByRepo.set(repo, asked);
  for (const p of paths) asked.add(p);
  const known = get(flagsByRepo)[repo] ?? NO_FLAGS;
  queuePaths(pending, repo, paths, (p) => Object.prototype.hasOwnProperty.call(known, p));
  if (pending.has(repo)) schedule();
}

/**
 * Reloads the repo's status and asks again about every path it has asked
 * about. Call after track, untrack or install, which change which files are LFS.
 */
export async function refreshLfs(repo: string): Promise<void> {
  await loadStatus(repo);
  queuePaths(pending, repo, [...(askedByRepo.get(repo) ?? [])], () => false);
  if (pending.has(repo)) schedule();
}

function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, LFS_DEBOUNCE_MS);
}

async function flush(): Promise<void> {
  const statuses = get(statusByRepo);
  const batches = takeReadyBatches(pending, (repo) => statuses[repo] !== undefined);
  await Promise.all(batches.map(askBatch));
}

// WHY the used check here: a repo whose .gitattributes names no LFS pattern
// gets "not LFS" for every path without any git call.
async function askBatch({ repo, paths }: PathBatch): Promise<void> {
  if (!get(statusByRepo)[repo].used) {
    setFlags(repo, paths, () => false);
    return;
  }
  try {
    const lfs = new Set(await ipc.lfsFiles(repo, paths));
    setFlags(repo, paths, (p) => lfs.has(p));
  } catch (e) {
    logAppend("warn", `git lfs files for ${repo} failed: ${e}`);
  }
}

function setFlags(repo: string, paths: readonly string[], valueOf: (p: string) => boolean): void {
  flagsByRepo.update((all) => {
    const next: LfsFlags = { ...(all[repo] ?? NO_FLAGS) };
    for (const p of paths) next[p] = valueOf(p);
    return { ...all, [repo]: next };
  });
}
