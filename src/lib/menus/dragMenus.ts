// Menu and execution for a branch drop. The pure option list comes from
// dragOptions.ts; this file turns it into a context menu at the drop point and
// runs the option the user picked. Nothing runs on drop itself. Merges and
// rebases are not recorded for undo; a checkout records its own entry (see
// docs/specs/ref-drag-and-drop.md).

import { ipc } from "$lib/ipc";
import { get } from "svelte/store";
import { openMenu, type MenuItem } from "$lib/stores/contextmenu";
import { graph } from "$lib/stores/repo";
import { notifySuccess, notifyError, notifyInfo } from "$lib/stores/notifications";
import { checkoutAndJump } from "$lib/stores/graphscroll";
import { findRefSha, fastForwardFailureMessage } from "$lib/stores/refLookup";
import { repo, runAction, headBranch } from "$lib/menus/menuActions";
import { dragOptions, type DragAction, type DragOption, type DragRef } from "$lib/menus/dragOptions";

const ICON: Record<DragAction["kind"], string> = {
  merge: "⊕",
  rebase: "↷",
  "fast-forward": "⇡",
};

/** The options for dropping `src` on `target` against the loaded graph. Empty
 * when the graph is not loaded or the pair offers nothing. */
export function dropOptionsFor(src: DragRef, target: DragRef): DragOption[] {
  const g = get(graph);
  if (!g) return [];
  return dragOptions(src, target, g.head_branch, g);
}

/** Opens the option menu at the drop point. Returns false, and opens nothing,
 * when the pair has no options. */
export function openDropMenu(e: MouseEvent, src: DragRef, target: DragRef): boolean {
  const options = dropOptionsFor(src, target);
  if (options.length === 0) return false;
  openMenu(e, options.map(dropMenuItem));
  return true;
}

function dropMenuItem(option: DragOption): MenuItem {
  return {
    label: option.label,
    icon: ICON[option.action.kind],
    onClick: () => runDragAction(option.action),
  };
}

/** Runs the option the user picked from the menu. */
export async function runDragAction(action: DragAction): Promise<void> {
  const r = repo();
  if (!r) return;
  if (action.kind === "merge") return mergeInto(r, action.checkout, action.from);
  if (action.kind === "rebase") return rebaseOnto(r, action.checkout, action.onto);
  return fastForward(r, action.branch, action.to, action.head);
}

// Checks out `name` through the shared checkout path, which records undo and
// asks about a dirty tree. True only when HEAD ended on it, so a failed or
// declined checkout stops the merge or rebase that follows.
async function checkoutFirst(name: string | null): Promise<boolean> {
  if (name === null) return true;
  await checkoutAndJump(name);
  return get(graph)?.head_branch === name;
}

async function mergeInto(r: string, checkout: string | null, from: string): Promise<void> {
  if (!(await checkoutFirst(checkout))) return;
  const res = await runAction(`Merge ${from}`, () => ipc.branchMerge(r, from, false));
  if (res.ok) notifySuccess("Merged", `${from} into ${headBranch()}`);
  else notifyError("Merge failed", res.error);
}

async function rebaseOnto(r: string, checkout: string | null, onto: string): Promise<void> {
  if (!(await checkoutFirst(checkout))) return;
  const res = await runAction(`Rebase onto ${onto}`, () => ipc.branchRebase(r, onto));
  if (res.ok) notifySuccess("Rebased", `${headBranch()} onto ${onto}`);
  else notifyError("Rebase failed", res.error);
}

// HEAD moves with `merge --ff-only`; any other local branch moves by ref update,
// so no checkout is needed. Both refuse a non-fast-forward move.
async function fastForward(r: string, branch: string, to: string, head: boolean): Promise<void> {
  const before = localBranchSha(branch);
  const res = await runAction(`Fast-forward ${branch}`, () =>
    head ? ipc.branchMergeFfOnly(r, to) : ipc.branchFastForwardLocal(r, to, branch),
  );
  if (!res.ok) {
    notifyError("Fast-forward failed", fastForwardFailureMessage(branch, res.error));
    return;
  }
  if (localBranchSha(branch) === before) notifyInfo("Already Up-to-Date", `${branch} was not moved.`);
  else notifySuccess("Fast-forwarded", `${branch} to ${to}`);
}

function localBranchSha(name: string): string | null {
  return findRefSha(get(graph)?.refs ?? [], "localbranch", name);
}
