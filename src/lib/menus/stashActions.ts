// Stash drop with Undo. The graph row, sidebar and stash details all drop
// through here, so every drop path records the same undo entry.

import { get } from "svelte/store";
import { ipc } from "$lib/ipc";
import { stashes } from "$lib/stores/repo";
import { confirmDialog } from "$lib/stores/dialog";
import { pushUndo } from "$lib/stores/history";
import { notifyError } from "$lib/stores/notifications";
import { stashDropUndo } from "$lib/stores/undoEntries";
import { runAction } from "$lib/menus/menuActions";

/** Confirms, then drops stash@{index}, and records an undo entry that puts
 * the stash commit back. Returns true when the stash was dropped.
 * Example: `if (await dropStashAt(repo, 0)) showChanges();` */
export async function dropStashAt(repo: string, index: number): Promise<boolean> {
  const entry = get(stashes).find((s) => s.index === index);
  if (!entry) {
    notifyError("Drop failed", `stash@{${index}} is no longer in the stash list`);
    return false;
  }
  const ok = await confirmDialog({
    title: `Drop stash@{${index}}?`,
    confirmLabel: "Drop",
    danger: true,
  });
  if (!ok) return false;
  const res = await runAction(`Drop stash@{${index}}`, () => ipc.stashDrop(repo, index));
  if (res.ok) pushUndo(stashDropUndo(repo, entry));
  return res.ok;
}
