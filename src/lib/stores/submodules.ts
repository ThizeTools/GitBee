// Submodule pane state and actions. The list lives on each repo tab and the
// full refresh in repoRefresh.ts fills it; this file adds the derived store,
// the pure helpers the pane shows, and the git actions. See docs/specs/submodules.md.
import { derived } from "svelte/store";
import { ipc, type Submodule, type SubmoduleState } from "$lib/ipc";
import { activeTab } from "$lib/stores/repoState";
import { openRepo, withBusy } from "$lib/stores/repo";
import { alertDialog, promptDialog, requireName } from "$lib/stores/dialog";

/** Submodules of the active repo tab. Empty when the repo has no `.gitmodules`. */
export const activeSubmodules = derived(activeTab, ($t) => $t?.submodules ?? []);

/** Badge text per state. Kept short: the sidebar row has little room. */
export const SUBMODULE_STATE_LABEL: Record<SubmoduleState, string> = {
  uninitialized: "not initialized",
  clean: "clean",
  modified: "modified",
  out_of_sync: "new commits",
  conflict: "conflict",
};

/** First seven characters of a sha, or "" when the submodule has none.
 * Example: shortSha("abcdef0123") === "abcdef0" */
export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "";
}

/** Joins a repo path and a repo-relative submodule path with the repo's own
 * separator. Git writes submodule paths with '/', Windows repo paths use '\\'.
 * Example: joinRepoPath("C:\\work\\app", "libs/foo") === "C:\\work\\app\\libs\\foo" */
export function joinRepoPath(repo: string, subPath: string): string {
  const sep = repo.includes("\\") ? "\\" : "/";
  const base = repo.replace(/[\\/]+$/, "");
  return [base, ...subPath.split("/")].join(sep);
}

/** A checkout exists only once the submodule is initialized. Opening an
 * uninitialized one would land on an empty folder, so the caller refuses it.
 * Example: canOpenSubmodule({ state: "clean", ... }) === true */
export function canOpenSubmodule(sub: Submodule): boolean {
  return sub.state !== "uninitialized";
}

/** Suggests the folder name for `git submodule add` from the URL's last segment.
 * Example: defaultSubPath("https://x/team/foo.git") === "foo" */
export function defaultSubPath(url: string): string {
  const last = url.replace(/[\\/]+$/, "").split(/[\\/:]/).pop() ?? "";
  return last.replace(/\.git$/, "");
}

/** Opens a submodule as a repo tab. An uninitialized one is refused with the
 * fix named, because a new tab there would show an empty folder.
 * Example: await openSubmoduleTab("C:\\work\\app", sub) */
export async function openSubmoduleTab(repo: string, sub: Submodule): Promise<void> {
  if (!canOpenSubmodule(sub)) {
    await alertDialog({
      title: `${sub.name} is not initialized`,
      message: "Initialize first: right-click it and choose Update (init).",
    });
    return;
  }
  await openRepo(joinRepoPath(repo, sub.path));
}

/** Updates one submodule, optionally initializing it first.
 * Example: await updateSubmodule(repo, sub, true) */
export async function updateSubmodule(repo: string, sub: Submodule, init: boolean): Promise<void> {
  await withBusy(() => ipc.submoduleUpdate(repo, sub.path, init, false));
}

/** Initializes and updates every submodule, recursively. */
export async function updateAllSubmodules(repo: string): Promise<void> {
  await withBusy(() => ipc.submoduleUpdate(repo, null, true, true));
}

/** Copies the URLs from `.gitmodules` into each checkout's config. */
export async function syncSubmoduleUrls(repo: string): Promise<void> {
  await withBusy(() => ipc.submoduleSync(repo));
}

/** Asks for a URL and a folder name, then adds the submodule. The folder name
 * defaults from the URL. Empty input is blocked by the prompt.
 * Example: await addSubmodule(repo) */
export async function addSubmodule(repo: string): Promise<void> {
  const url = await promptDialog({
    title: "Submodule URL or path:", confirmLabel: "Next", validate: requireName,
  });
  if (url === null) return;
  const subPath = await promptDialog({
    title: "Folder inside the repo:", initial: defaultSubPath(url.trim()),
    confirmLabel: "Add", validate: requireName,
  });
  if (subPath === null) return;
  await withBusy(() => ipc.submoduleAdd(repo, url.trim(), subPath.trim()));
}
