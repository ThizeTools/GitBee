// Pure lookups over graph refs and stash lists, shared by undo entries and
// menus. Type-only imports from $lib/ipc keep this file free of Tauri at
// runtime, so bun test can load it.

import type { CommitRef, RefKind, StashEntry } from "$lib/ipc";

/** Where HEAD was: a branch name, or a commit sha when detached. */
export interface CheckoutTarget {
  ref: string;
  isBranch: boolean;
}

/** Returns the sha a ref of `kind` and `name` points at, or null when the
 * graph has no such ref. Example: `findRefSha(g.refs, "tag", "v1.0")` */
export function findRefSha(
  refs: readonly CommitRef[],
  kind: RefKind,
  name: string,
): string | null {
  const hit = refs.find((r) => r.kind === kind && r.name === name);
  return hit ? hit.target_sha : null;
}

/** Picks the remote that tracks `branch` (has `<remote>/<branch>` in refs).
 * `origin` wins when several remotes have it. Null when none does. */
export function pickRemoteForBranch(
  remoteNames: readonly string[],
  refs: readonly CommitRef[],
  branch: string,
): string | null {
  const preferred = [...remoteNames].sort(
    (a, b) => Number(b === "origin") - Number(a === "origin"),
  );
  return preferred.find((remote) => hasRemoteBranch(refs, remote, branch)) ?? null;
}

function hasRemoteBranch(refs: readonly CommitRef[], remote: string, branch: string): boolean {
  const full = `${remote}/${branch}`;
  return refs.some((r) => r.kind === "remotebranch" && r.name === full);
}

/** Index of the stash commit `sha` in the current list, or null if it was
 * dropped or applied meanwhile. */
export function findStashIndex(stashes: readonly StashEntry[], sha: string): number | null {
  const hit = stashes.find((s) => s.sha === sha);
  return hit ? hit.index : null;
}

/** HEAD as a checkout target: its branch when attached, else its sha. Null
 * on an unborn branch, where there is nothing to return to. */
export function checkoutTargetOf(
  headBranch: string | null,
  headSha: string | null,
): CheckoutTarget | null {
  if (headBranch) return { ref: headBranch, isBranch: true };
  if (headSha) return { ref: headSha, isBranch: false };
  return null;
}

/** Message for a failed fast-forward. `stderr` is git's text, kept so the
 * user sees the real cause. */
export function fastForwardFailureMessage(branch: string, stderr: string): string {
  const detail = stderr.trim();
  if (/non-fast-forward|rejected/.test(detail)) {
    return `${branch} has commits its remote does not have, so it cannot be fast-forwarded. Merge or rebase instead.\n${detail}`;
  }
  return detail;
}
