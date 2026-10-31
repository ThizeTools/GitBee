// Actions that act on the open repo. The repo is read when the item runs, not
// when the palette opened, so a tab switch in between cannot retarget it.
// Behaviour mirrors the top bar and the branch menu they duplicate.

import { get } from "svelte/store";
import { ipc } from "$lib/ipc";
import { currentRepo, graph, stashes, refreshAll, withBusy } from "$lib/stores/repo";
import { runAction } from "$lib/menus/menuActions";
import { pushUndo } from "$lib/stores/history";
import { branchCreateUndo } from "$lib/stores/undoEntries";
import { confirmDialog, promptDialog, requireName } from "$lib/stores/dialog";
import { notifyError, notifyInfo, notifySuccess } from "$lib/stores/notifications";
import { addSubmodule } from "$lib/stores/submodules";
import { paletteAction } from "$lib/palette/providers/item";
import type { PaletteItem } from "$lib/palette/types";

async function onRepo(fn: (repo: string) => Promise<unknown>): Promise<void> {
  const repo = get(currentRepo);
  if (repo) await fn(repo);
}

async function pushHead(repo: string): Promise<void> {
  const branch = get(graph)?.head_branch ?? undefined;
  const label = branch ? `Push ${branch}` : "Push";
  const r = await runAction(label, () => ipc.remotePush(repo, "origin", branch, false));
  if (!r.ok) notifyError("Push failed", r.error);
  else notifySuccess("Pushed Successfully", branch ? `${branch} → origin` : undefined);
}

async function stashAll(repo: string): Promise<void> {
  const m = await promptDialog({ title: "Stash message:", confirmLabel: "Stash" });
  // Cancelling (null) aborts the stash. An empty message means no message.
  if (m === null) return;
  await withBusy(() => ipc.stashCreate(repo, m || undefined, true));
}

async function popTopStash(repo: string): Promise<void> {
  if (get(stashes).length === 0) {
    notifyInfo("Nothing to pop", "The stash list is empty");
    return;
  }
  const ok = await confirmDialog({ title: "Pop stash@{0}?", confirmLabel: "Pop" });
  if (!ok) return;
  const r = await runAction("Pop stash@{0}", () => ipc.stashPop(repo, 0));
  if (r.ok) notifySuccess("Stash popped", "stash@{0}");
  else notifyError("Pop failed", r.error);
}

// Creates the branch at HEAD without checking it out, as the palette always did.
async function newBranchFromHead(repo: string): Promise<void> {
  const name = await promptDialog({ title: "Branch name:", validate: requireName });
  if (!name) return;
  const sha = get(graph)?.head_sha ?? undefined;
  const res = await runAction(`Create branch ${name}`, () => ipc.branchCreate(repo, name));
  if (res.ok) pushUndo(branchCreateUndo(repo, name, sha));
}

export function repoActionItems(): PaletteItem[] {
  return [
    paletteAction("refresh", "Refresh repo", () => refreshAll()),
    paletteAction("fetch", "Fetch all remotes", () =>
      onRepo((r) => withBusy(() => ipc.remoteFetch(r)))),
    paletteAction("pull", "Pull", () =>
      onRepo((r) => withBusy(() => ipc.remotePull(r, false)))),
    paletteAction("pull-rebase", "Pull (rebase)", () =>
      onRepo((r) => withBusy(() => ipc.remotePull(r, true)))),
    paletteAction("push", "Push", () => onRepo(pushHead)),
    paletteAction("stash-create", "Stash all changes", () => onRepo(stashAll)),
    paletteAction("stash-pop", "Pop stash", () => onRepo(popTopStash), "stash@{0}"),
    paletteAction("branch-create", "New branch from HEAD", () => onRepo(newBranchFromHead)),
    paletteAction("submodule-add", "Add submodule…", () => onRepo(addSubmodule)),
  ];
}
