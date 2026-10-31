// Context-menu actions for stash rows in the graph. The repo path is passed
// as a getter, not a value, because the original handlers read the active
// repo at click time, not when the menu was opened.
import { ipc } from "$lib/ipc";
import { withBusy } from "$lib/stores/repo";
import { showChanges } from "$lib/stores/rightpanel";
import type { MenuItem } from "$lib/stores/contextmenu";

export type RepoGetter = () => string | null;

export interface StashMenuArgs {
  getRepo: RepoGetter;
  idx: number;
  message: string;
  onHide: () => void;
}

export async function applyStash(getRepo: RepoGetter, idx: number): Promise<void> {
  const repo = getRepo();
  if (!repo) return;
  await withBusy(() => ipc.stashApply(repo, idx));
}

export async function popStash(getRepo: RepoGetter, idx: number): Promise<void> {
  const repo = getRepo();
  if (!repo) return;
  await withBusy(() => ipc.stashPop(repo, idx));
  showChanges();
}

export async function dropStash(getRepo: RepoGetter, idx: number): Promise<void> {
  const repo = getRepo();
  if (!repo || !confirm(`Drop stash@{${idx}}?`)) return;
  await withBusy(() => ipc.stashDrop(repo, idx));
  showChanges();
}

export async function editStashMessage(
  getRepo: RepoGetter,
  idx: number,
  current: string,
): Promise<void> {
  const repo = getRepo();
  if (!repo) return;
  const m = prompt("Edit stash message:", current);
  if (m === null) return;
  await withBusy(() => ipc.stashEditMessage(repo, idx, m));
}

// Stash row → stash-specific menu. Hide only updates the caller's local
// hidden set, so it is passed in as a callback.
export function stashMenuItems(args: StashMenuArgs): MenuItem[] {
  const { getRepo, idx, message, onHide } = args;
  return [
    { label: "Apply Stash", icon: "↻", onClick: () => applyStash(getRepo, idx) },
    { label: "Pop Stash", icon: "⤴", onClick: () => popStash(getRepo, idx) },
    { label: "Delete Stash", icon: "🗑", danger: true, onClick: () => dropStash(getRepo, idx) },
    { separator: true, label: "" },
    { label: "Edit stash message", icon: "✎", onClick: () => editStashMessage(getRepo, idx, message) },
    { label: "Hide", icon: "○", onClick: onHide },
  ];
}
