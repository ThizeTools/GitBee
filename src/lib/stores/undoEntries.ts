// Undo entries for GitBee's repo actions. Each factory runs after its action
// succeeded and gets the state captured before it ran. Closures act on the
// repo path passed in (not the active tab), so an undo always hits the repo
// the action was made in. Spec: docs/specs/undo-history.md.

import { ipc, type StashEntry } from "$lib/ipc";
import type { UndoEntry } from "$lib/stores/historyStack";
import { findStashIndex, type CheckoutTarget } from "$lib/stores/refLookup";

type ResetMode = Parameters<typeof ipc.reset>[2];

async function checkoutTo(repo: string, target: CheckoutTarget): Promise<void> {
  if (target.isBranch) await ipc.branchCheckout(repo, target.ref);
  else await ipc.checkoutSha(repo, target.ref);
}

/** Undo returns to `previous`. Redo runs `forward`, the same checkout again. */
export function checkoutUndo(
  repo: string,
  previous: CheckoutTarget,
  label: string,
  forward: () => Promise<unknown>,
): UndoEntry {
  return {
    label: `Checkout ${label}`,
    undo: () => checkoutTo(repo, previous),
    redo: async () => { await forward(); },
  };
}

/** Undo deletes the branch. Redo creates it again at `sha` (HEAD when omitted). */
export function branchCreateUndo(repo: string, name: string, sha: string | undefined): UndoEntry {
  return {
    label: `Create branch ${name}`,
    undo: async () => { await ipc.branchDelete(repo, name, false); },
    redo: async () => { await ipc.branchCreate(repo, name, sha); },
  };
}

/** Undo recreates the deleted branch at `sha`. Redo deletes it again. */
export function branchDeleteUndo(repo: string, name: string, sha: string): UndoEntry {
  return {
    label: `Delete branch ${name}`,
    undo: async () => { await ipc.branchCreate(repo, name, sha); },
    redo: async () => { await ipc.branchDelete(repo, name, false); },
  };
}

/** Undo deletes the new tag. Redo recreates it with the same target and message. */
export function tagCreateUndo(
  repo: string,
  name: string,
  sha: string,
  message: string | undefined,
): UndoEntry {
  return {
    label: `Create tag ${name}`,
    undo: async () => { await ipc.tagDelete(repo, name); },
    redo: async () => { await ipc.tagCreate(repo, name, sha, message); },
  };
}

/** Undo recreates the tag at its commit. Redo deletes it again. An annotated
 * tag comes back lightweight: its message is not kept (see the spec). */
export function tagDeleteUndo(repo: string, name: string, sha: string): UndoEntry {
  return {
    label: `Delete tag ${name}`,
    undo: async () => { await ipc.tagCreate(repo, name, sha, undefined); },
    redo: async () => { await ipc.tagDelete(repo, name); },
  };
}

/** Undo moves HEAD back to `before` in the same mode. Redo moves it to `target`. */
export function resetUndo(
  repo: string,
  mode: ResetMode,
  before: string,
  target: string,
): UndoEntry {
  return {
    label: `Reset (${mode}) to ${target.slice(0, 7)}`,
    undo: async () => { await ipc.reset(repo, before, mode); },
    redo: async () => { await ipc.reset(repo, target, mode); },
  };
}

/** Resets the worktree to `target` after keeping its changes in a backup
 * commit. If the reset fails, the changes are restored and the error is
 * rethrown. Returns the backup sha, or null when there were no changes.
 * Example: `const backup = await resetHardKeepingChanges(repo, sha)` */
export async function resetHardKeepingChanges(repo: string, target: string): Promise<string | null> {
  const backup = await ipc.discardAllWithBackup(repo);
  try {
    await ipc.reset(repo, target, "hard");
  } catch (e) {
    if (backup) await ipc.applyBackup(repo, backup);
    throw e;
  }
  return backup;
}

/** Undo resets to `before` and brings the backed-up changes back. Redo makes
 * a fresh backup of whatever the undo restored, then resets to `target`. */
export function hardResetUndo(
  repo: string,
  before: string,
  target: string,
  backup: string | null,
): UndoEntry {
  let saved = backup;
  return {
    label: `Reset --hard to ${target.slice(0, 7)}`,
    undo: async () => {
      await ipc.reset(repo, before, "hard");
      if (saved) await ipc.applyBackup(repo, saved);
    },
    redo: async () => { saved = await resetHardKeepingChanges(repo, target); },
  };
}

/** Undo soft-resets to `before`, which keeps the new commit's tree staged.
 * Redo commits again with the same message (`amend` for an amend). Uses the
 * captured HEAD, not HEAD@{1}, so stacked undos still find the right commit. */
export function commitUndo(
  repo: string,
  before: string,
  subject: string,
  message: string,
  amend: boolean,
): UndoEntry {
  return {
    label: `Commit ${subject}`,
    undo: async () => { await ipc.reset(repo, before, "soft"); },
    redo: async () => { await ipc.commitCreate(repo, message, amend, false); },
  };
}

/** Undo restores the file's backed-up bytes, or deletes it when `blob` is
 * null (the file did not exist). Redo backs the restored file up again and
 * discards it. */
export function discardFileUndo(repo: string, file: string, blob: string | null): UndoEntry {
  let saved = blob;
  return {
    label: `Discard changes in ${file}`,
    undo: async () => { await ipc.restoreFile(repo, file, saved); },
    redo: async () => {
      saved = await ipc.backupFile(repo, file);
      await ipc.discardFile(repo, file);
    },
  };
}

/** Undo re-applies the discard-all backup commit. Redo discards again and
 * keeps the new backup. */
export function discardAllUndo(repo: string, backup: string): UndoEntry {
  let saved = backup;
  return {
    label: "Discard all changes",
    undo: async () => { await ipc.applyBackup(repo, saved); },
    redo: async () => {
      const next = await ipc.discardAllWithBackup(repo);
      if (next === null) throw new Error("there are no changes left to discard");
      saved = next;
    },
  };
}

/** Undo puts the dropped stash commit back on the stash list. Redo finds it
 * again by sha, since its index changed, and drops it. */
export function stashDropUndo(repo: string, entry: StashEntry): UndoEntry {
  return {
    label: `Drop stash "${entry.message}"`,
    undo: async () => { await ipc.stashStore(repo, entry.sha, entry.message); },
    redo: async () => {
      const index = findStashIndex(await ipc.stashList(repo), entry.sha);
      if (index === null) {
        throw new Error(`stash ${entry.sha.slice(0, 7)} is no longer in the stash list`);
      }
      await ipc.stashDrop(repo, index);
    },
  };
}
