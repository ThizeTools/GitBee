// Context menu for tag refs, plus the cache of tags already pushed to origin
// that decides whether "Push to origin" is still offered.

import type { MenuItem } from "$lib/stores/contextmenu";
import { ipc } from "$lib/ipc";
import { graph } from "$lib/stores/repo";
import { get } from "svelte/store";
import { pushUndo } from "$lib/stores/history";
import { tagDeleteUndo } from "$lib/stores/undoEntries";
import { findRefSha } from "$lib/stores/refLookup";
import { logAppend } from "$lib/stores/logs";
import { notifySuccess, notifyError } from "$lib/stores/notifications";
import { confirmDialog, promptDialog } from "$lib/stores/dialog";
import {
  repo,
  copy,
  runAction,
  headBranch,
  headSha,
  viewFilterItems,
  createBranchHereItem,
  cherryPickCommitItem,
  resetToCommitItem,
  revertCommitItem,
  checkoutCommitItem,
  openWorktreeCreate,
} from "$lib/menus/menuActions";

// `git tag -f <name> <head_sha>`. We resolve HEAD up-front so the
// command shows a precise label in logs and the destructive nature of
// `-f` is visible to the user via the confirm dialog.
async function fastForwardTag(tagName: string): Promise<void> {
  const r = repo();
  const head = headSha();
  if (!r || !head) return;
  const ok = await confirmDialog({
    title: `Fast-forward ${tagName} to ${head.slice(0, 7)}?`,
    message: "This rewrites the tag and may need a force-push.",
    confirmLabel: "Fast-forward",
  });
  if (!ok) return;
  const res = await runAction(`FF tag ${tagName}`, () =>
    ipc.tagMove(r, tagName, head),
  );
  if (res.ok) notifySuccess("Tag moved", `${tagName} → ${head.slice(0, 7)}`);
  else notifyError("FF tag failed", res.error);
}

// Lightweight tag → annotated tag (or change an existing message).
// The message is single-line for most workflows, so the inline prompt
// dialog is enough; a multi-line editor would need its own dialog kind.
async function annotateTag(tagName: string): Promise<void> {
  const r = repo();
  if (!r) return;
  const message = await promptDialog({
    title: `Annotation message for ${tagName}:`,
    confirmLabel: "Annotate",
  });
  if (message === null || message.trim() === "") return;
  const res = await runAction(`Annotate ${tagName}`, () =>
    ipc.tagAnnotate(r, tagName, message.trim()),
  );
  if (res.ok) notifySuccess("Tag annotated", tagName);
  else notifyError("Annotate failed", res.error);
}

// Deleting records the tag's commit, so Undo can recreate the tag there.
async function deleteTag(repo: string, name: string): Promise<void> {
  const sha = findRefSha(get(graph)?.refs ?? [], "tag", name);
  const res = await runAction(`Delete tag ${name}`, () => ipc.tagDelete(repo, name));
  if (res.ok && sha) pushUndo(tagDeleteUndo(repo, name, sha));
}

// --- Tag ---
export function tagMenu(tagName: string, sha: string): MenuItem[] {
  const head = headBranch();
  return [
    // Group 1
    {
      label: `Push ${tagName} to origin`,
      icon: "↑",
      // Hidden when the tag already exists on origin (#3 round 9).
      hidden: tagExistsOnOrigin(tagName),
      onClick: async () => {
        const r = repo();
        if (!r) return;
        const res = await runAction(`Pushing ${tagName} to origin`, () =>
          ipc.tagPush(r, "origin", tagName),
        );
        if (res.ok) {
          notifySuccess("Pushed Successfully", `${tagName} to origin`);
          // Refresh the cached remote tag set so the menu hides on next open.
          refreshRemoteTags();
        } else {
          notifyError("Push failed", res.error);
        }
      },
    },
    { separator: true, label: "" },
    // Group 2
    {
      label: `Fast-forward ${tagName} to ${head}`,
      icon: "⇉",
      onClick: () => fastForwardTag(tagName),
    },
    {
      label: `Merge ${tagName} into ${head}`,
      icon: "⫶",
      onClick: async () => {
        const r = repo();
        if (!r) return;
        const ok = await confirmDialog({ title: `Merge ${tagName} into ${head}?`, confirmLabel: "Merge" });
        if (!ok) return;
        const res = await runAction(`Merge ${tagName}`, () =>
          ipc.branchMerge(r, tagName, false),
        );
        if (res.ok) notifySuccess("Merged", `${tagName} → ${head}`);
        else notifyError("Merge failed", res.error);
      },
    },
    {
      label: `Rebase ${head} onto ${tagName}`,
      icon: "⇄",
      onClick: async () => {
        const r = repo();
        if (!r) return;
        const ok = await confirmDialog({ title: `Rebase ${head} onto ${tagName}?`, confirmLabel: "Rebase" });
        if (!ok) return;
        const res = await runAction(`Rebase ${head} onto ${tagName}`, () =>
          ipc.branchRebase(r, tagName),
        );
        if (res.ok) notifySuccess("Rebased", `${head} onto ${tagName}`);
        else notifyError("Rebase failed", res.error);
      },
    },
    { separator: true, label: "" },
    // Group 3
    checkoutCommitItem(sha, `Checkout the commit at ${tagName}`),
    {
      label: `Create worktree from ${tagName}`,
      icon: "📂",
      // refs/tags/ spells out that this is a tag, so a branch with the same
      // name cannot be picked instead. The worktree is detached at the tag.
      onClick: () => openWorktreeCreate(`refs/tags/${tagName}`, tagName),
    },
    { separator: true, label: "" },
    // Group 5 (former Group 4 removed — "Explain Branch Changes" dropped)
    createBranchHereItem(sha),
    cherryPickCommitItem(sha),
    resetToCommitItem(sha),
    revertCommitItem(sha),
    { separator: true, label: "" },
    // Group 6
    {
      label: `Delete ${tagName} locally`,
      icon: "🗑",
      danger: true,
      onClick: async () => {
        const r = repo();
        if (!r) return;
        const ok = await confirmDialog({
          title: `Delete tag ${tagName}?`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (ok) await deleteTag(r, tagName);
      },
    },
    { separator: true, label: "" },
    // Group 7
    {
      label: "Copy tag name",
      icon: "⧉",
      onClick: () => copy(tagName, "tag name"),
    },
    { separator: true, label: "" },
    // Group 8 — view filters
    ...viewFilterItems(tagName, tagName),
    { separator: true, label: "" },
    // Group 9
    {
      label: `Annotate ${tagName}`,
      icon: "✎",
      onClick: () => annotateTag(tagName),
    },
  ];
}

// Best-effort GitHub URL builder. Reads `origin` URL from the loaded
// remotes (we don't have it here, so we delegate to a helper IPC). For now
// we just copy a placeholder — real link generation needs the remote URL.
// Cached set of tag names that already exist on origin. Built lazily; we
// refresh it when the user opens a repo or pushes a tag (#3 round 9).
const remoteTagsCache = { repo: "", tags: new Set<string>() };
let remoteTagsLoading = false;

export function tagExistsOnOrigin(tag: string): boolean {
  const r = repo() ?? "";
  if (remoteTagsCache.repo !== r) {
    if (!remoteTagsLoading) refreshRemoteTags();
    return false; // assume not, surface the menu item until we know
  }
  return remoteTagsCache.tags.has(tag);
}

export async function refreshRemoteTags(): Promise<void> {
  const r = repo();
  if (!r) return;
  remoteTagsLoading = true;
  try {
    const list = await ipc.remoteTags(r, "origin");
    remoteTagsCache.repo = r;
    remoteTagsCache.tags = new Set(list);
  } catch (e) {
    logAppend("warn", `remote_tags origin: ${e}`);
  } finally {
    remoteTagsLoading = false;
  }
}
