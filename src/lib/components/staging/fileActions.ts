import { get } from "svelte/store";
import { ipc } from "$lib/ipc";
import { currentRepo, withBusy } from "$lib/stores/repo";
import { logAppend } from "$lib/stores/logs";

// Repo-bound file actions for the staging lists and their context menu.
// Each reads the open repo at call time, so a menu item clicked after a tab
// switch acts on the tab that is open at that moment.

/** Stage one file in the open repo. */
export async function stageFile(path: string): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  await withBusy(() => ipc.stageFile(repo, path));
}

/** Unstage one file in the open repo. */
export async function unstageFile(path: string): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  await withBusy(() => ipc.unstageFile(repo, path));
}

/** Discard worktree changes for one file, after a confirm prompt. */
export async function discardFile(path: string): Promise<void> {
  const repo = get(currentRepo);
  if (!repo || !confirm(`Discard changes in ${path}?`)) return;
  await withBusy(() => ipc.discardFile(repo, path));
}

/** Stage every change in the open repo. */
export async function stageAll(): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  await withBusy(() => ipc.stageAll(repo));
}

/** Unstage every change in the open repo. */
export async function unstageAll(): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  await withBusy(() => ipc.unstageAll(repo));
}

/** Stage a batch of paths in one IPC call. */
export async function stageFiles(paths: string[]): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  await withBusy(() => ipc.stageFiles(repo, paths));
}

/** Unstage a batch of paths in one IPC call. */
export async function unstageFiles(paths: string[]): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  await withBusy(() => ipc.unstageFiles(repo, paths));
}

/** Discard every change, including untracked files. The caller confirms first. */
export async function discardAllChanges(): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  await withBusy(() => ipc.discardAllChanges(repo));
  logAppend("info", "discarded all changes (reset --hard + clean -fd)");
}

/** Append a path to the repo's .gitignore. */
export async function addIgnore(p: string): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  await withBusy(() => ipc.ignoreAdd(repo, p));
  logAppend("info", `gitignore: added "${p}"`);
}

/** Stash a single file, with an optional message prompt. */
export async function stashOneFile(f: string): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  const m = prompt("Stash message (optional):", `wip: ${f}`) || undefined;
  await withBusy(() => ipc.stashFile(repo, f, m));
}

/** Show the last 50 commits touching a file in an alert. */
export async function fileHistory(f: string): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  try {
    const rows = await ipc.fileHistory(repo, f, 50);
    logAppend("info", `History for ${f}: ${rows.length} commits`);
    alert(rows.map((r) => `${r.sha.slice(0,7)} ${r.subject}`).join("\n") || "(no history)");
  } catch (e) { logAppend("error", `history: ${e}`); }
}

/** Show the first 40 blame lines of a file in an alert. */
export async function fileBlame(f: string): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  try {
    const rows = await ipc.fileBlame(repo, f);
    logAppend("info", `Blame ${f}: ${rows.length} lines`);
    alert(rows.slice(0, 40).map((r) => `${r.sha.slice(0,7)} ${r.author}: ${r.line}`).join("\n"));
  } catch (e) { logAppend("error", `blame: ${e}`); }
}

/** Reveal a file in the OS file manager. */
export async function showInFolder(f: string): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  try { await ipc.fileShowInFolder(repo, f); }
  catch (e) { logAppend("error", `show in folder: ${e}`); }
}

/** Copy a repo-relative path to the clipboard. */
export async function copyPath(f: string): Promise<void> {
  try { await navigator.clipboard.writeText(f); logAppend("info", `copied: ${f}`); }
  catch (e) { logAppend("error", `copy: ${e}`); }
}

/** Open a file in the user's editor. */
export async function editFile(f: string): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  try { await ipc.fileEdit(repo, f); }
  catch (e) { logAppend("error", `edit: ${e}`); }
}

/** Delete a file from disk, after a confirm prompt. */
export async function deleteFile(f: string): Promise<void> {
  const repo = get(currentRepo);
  if (!repo || !confirm(`Delete file ${f}?`)) return;
  try { await withBusy(() => ipc.fileDelete(repo, f)); }
  catch (e) { logAppend("error", `delete: ${e}`); }
}
