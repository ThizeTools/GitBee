import { get } from "svelte/store";
import { ipc } from "$lib/ipc";
import { currentRepo, withBusy } from "$lib/stores/repo";
import { logAppend } from "$lib/stores/logs";
import { confirmDialog, promptDialog } from "$lib/stores/dialog";
import { showFileBlame, showFileHistory } from "$lib/stores/center";
import { pushUndo } from "$lib/stores/history";
import { notifyError } from "$lib/stores/notifications";
import { discardAllUndo, discardFileUndo } from "$lib/stores/undoEntries";
import { runAction } from "$lib/menus/menuActions";

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

/** Discard worktree changes for one file, after a confirm dialog. The file's
 * bytes are backed up first, so Undo can restore them. */
export async function discardFile(path: string): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  const ok = await confirmDialog({ title: `Discard changes in ${path}?`, confirmLabel: "Discard", danger: true });
  if (!ok) return;
  let blob: string | null;
  try {
    blob = await ipc.backupFile(repo, path);
  } catch (e) {
    notifyError("Discard aborted", `could not back up ${path}: ${e}`);
    return;
  }
  const res = await runAction(`Discard ${path}`, () => ipc.discardFile(repo, path));
  if (res.ok) pushUndo(discardFileUndo(repo, path, blob));
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

/** Discard every change, including untracked files. The caller confirms first.
 * The changes go to a backup commit, so Undo can restore them. */
export async function discardAllChanges(): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  const backup = await withBusy(() => ipc.discardAllWithBackup(repo));
  if (backup === null) return;
  pushUndo(discardAllUndo(repo, backup));
  logAppend("info", "discarded all changes (kept in a backup for Undo)");
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
  const typed = await promptDialog({ title: "Stash message (optional):", initial: `wip: ${f}`, confirmLabel: "Stash" });
  // Cancelling (null) aborts. An empty message keeps the default: no message.
  if (typed === null) return;
  await withBusy(() => ipc.stashFile(repo, f, typed || undefined));
}

/** Opens the commit history of a file in the center pane. */
export function fileHistory(f: string): void {
  showFileHistory(f);
}

/** Opens blame for a file in the center pane, for the working tree. */
export function fileBlame(f: string): void {
  showFileBlame(f);
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

/** Delete a file from disk, after a confirm dialog. */
export async function deleteFile(f: string): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  const ok = await confirmDialog({ title: `Delete file ${f}?`, confirmLabel: "Delete", danger: true });
  if (!ok) return;
  try { await withBusy(() => ipc.fileDelete(repo, f)); }
  catch (e) { logAppend("error", `delete: ${e}`); }
}
