// The three hunk and line actions and the git calls each one makes. The git
// calls go through an injected PatchIo, so the tests run with a fake and the
// app passes `ipc`. Spec: docs/specs/hunk-staging.md.

import type { FileDiff } from "$lib/ipc";
import { buildPatch, type PatchSelection } from "./patchBuilder";

/** Stage adds picked changes to the index. Unstage removes them from the index. Discard removes them from the worktree. */
export type PatchAction = "stage" | "unstage" | "discard";

/** The git calls a patch action makes. The app's `ipc` object satisfies it. */
export interface PatchIo {
  applyPatchText(repo: string, patch: string, cached: boolean, reverse: boolean): Promise<void>;
  backupFile(repo: string, file: string): Promise<string | null>;
}

/** What a discard needs to be undone: the file's bytes before the discard, and the patch that discarded. */
export interface DiscardBackup {
  file: string;
  blob: string | null;
  patch: string;
}

/** The git flags an action uses. Stage works on the index forward. The others run in reverse. */
export function planFor(action: PatchAction): { cached: boolean; reverse: boolean } {
  if (action === "stage") return { cached: true, reverse: false };
  if (action === "unstage") return { cached: true, reverse: true };
  return { cached: false, reverse: true };
}

/**
 * Runs one action on the selected changes of `file`. Returns the backup a
 * discard needs for its undo entry, and null for stage and unstage. Returns
 * null with no git call when nothing is selected. A failed apply throws, so
 * no backup is returned and no undo entry is recorded.
 * Usage: const backup = await runPatchAction(ipc, repo, file, sel, "discard")
 */
export async function runPatchAction(
  io: PatchIo,
  repo: string,
  file: FileDiff,
  selection: PatchSelection,
  action: PatchAction,
): Promise<DiscardBackup | null> {
  const plan = planFor(action);
  const patch = buildPatch(file, selection, plan.reverse);
  if (patch === null) return null;
  const path = file.new_path || file.old_path;
  if (action !== "discard") {
    await io.applyPatchText(repo, patch, plan.cached, plan.reverse);
    return null;
  }
  // Backup first: the blob is the only record of the bytes the apply replaces.
  const blob = await io.backupFile(repo, path);
  await io.applyPatchText(repo, patch, plan.cached, plan.reverse);
  return { file: path, blob, patch };
}
