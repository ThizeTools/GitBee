// The toast shown after a successful pull of HEAD. Shared by the top bar,
// the branch menu and the palette so the three report a pull the same way.
// Spec: docs/specs/pull-autostash.md.

import type { PullOutcome } from "$lib/ipc";
import { notifyInfo, notifySuccess } from "$lib/stores/notifications";

export interface PullNotice {
  kind: "info" | "success";
  title: string;
  message?: string;
}

/**
 * Picks the toast for a finished pull. A kept stash wins over the rest,
 * because the user's changes are no longer in the working tree.
 * Example: pullNotice({ stash_kept: false }, "main", true) gives "Pulled Successfully".
 */
export function pullNotice(outcome: PullOutcome, branch: string, moved: boolean): PullNotice {
  if (outcome.stash_kept) {
    return {
      kind: "info",
      title: "Pulled, but stash kept",
      message: "Your local changes conflicted with the pulled commits. Resolve the conflicted files, or reset them; the changes are also kept in stash@{0}.",
    };
  }
  if (!moved) {
    return {
      kind: "info",
      title: "Already Up-to-Date",
      message: `No merge necessary. Branch origin/${branch} was not moved.`,
    };
  }
  return { kind: "success", title: "Pulled Successfully" };
}

export function notifyPull(outcome: PullOutcome, branch: string, moved: boolean): void {
  const n = pullNotice(outcome, branch, moved);
  if (n.kind === "success") notifySuccess(n.title, n.message);
  else notifyInfo(n.title, n.message);
}
