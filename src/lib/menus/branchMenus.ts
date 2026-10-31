// Context menus for local and remote branch refs. Entries shared with the
// commit and tag menus come from menuActions.ts.

import type { MenuItem } from "$lib/stores/contextmenu";
import { ipc } from "$lib/ipc";
import { withBusy, graph, remotes } from "$lib/stores/repo";
import { notifySuccess, notifyError, notifyInfo } from "$lib/stores/notifications";
import { checkoutAndJump, checkoutRemoteAndJump } from "$lib/stores/graphscroll";
import { confirmDialog, promptDialog, requireName } from "$lib/stores/dialog";
import { get } from "svelte/store";
import { openModal } from "$lib/stores/modals";
import { pullRequestCompareUrl, branchWebUrl } from "$lib/github/url";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  repo,
  copy,
  runAction,
  remoteUrlByName,
  openWorktreeCreate,
  viewFilterItems,
  createBranchHereItem,
  resetToCommitItem,
  editCommitMessageItem,
  revertCommitItem,
  copyCommitShaItem,
  copyCommitLinkItem,
  createTagHereItems,
} from "$lib/menus/menuActions";

function originUrl(): string | null {
  const list = get(remotes);
  const origin = list.find((r) => r.name === "origin") ?? list[0];
  return origin?.url ?? null;
}

function openSetUpstream(branch: string): void {
  openModal({ kind: "set-upstream", branch });
}

// Pick a `.patch` / `.diff` file via the OS dialog and apply it to the
// working tree with `git apply --3way`. The result lands as unstaged
// changes (and conflicts when --3way falls back); the user reviews and
// commits like any other edit.
async function applyPatch(): Promise<void> {
  const r = repo();
  if (!r) return;
  const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
  const picked = await openDialog({
    multiple: false,
    title: "Select patch file",
    filters: [{ name: "Patch", extensions: ["patch", "diff"] }],
  });
  if (typeof picked !== "string") return;
  const res = await runAction(`Apply patch ${picked}`, () =>
    ipc.patchApply(r, picked),
  );
  if (res.ok) notifySuccess("Patch applied", picked.split(/[\\/]/).pop() ?? picked);
  else notifyError("Apply failed", res.error);
}

// Fire the "Start a pull request" flow by opening GitHub's compare page
// for the given branch in the system browser. GitHub auto-picks the base
// (the repo's default branch) and `?expand=1` lands the user on the PR
// creation form. Falls back to a notification when the remote isn't on
// github.com or we don't have an origin URL.
async function startPullRequest(branch: string): Promise<void> {
  const url = originUrl();
  if (!url) { notifyError("No remote", "Add an origin remote first"); return; }
  const compare = pullRequestCompareUrl(url, branch);
  if (!compare) {
    notifyInfo("Not a GitHub remote", "Open PR is supported only for github.com remotes");
    return;
  }
  try { await openUrl(compare); }
  catch (e) { notifyError("Could not open browser", String(e)); }
}

async function renameBranch(oldName: string) {
  const r = repo();
  if (!r) return;
  const name = await promptDialog({
    title: `Rename branch "${oldName}" to:`,
    initial: oldName,
    confirmLabel: "Rename",
    validate: requireName,
  });
  if (!name || name === oldName) return;
  await withBusy(() => ipc.branchRename(r, oldName, name));
}

async function deleteBranch(name: string) {
  const r = repo();
  if (!r) return;
  const ok = await confirmDialog({
    title: `Delete local branch "${name}"?`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  await withBusy(() => ipc.branchDelete(r, name, false));
}

async function deleteRemoteBranch(remote: string, branch: string) {
  const r = repo();
  if (!r) return;
  const ok = await confirmDialog({
    title: `Delete remote branch ${remote}/${branch}?`,
    message: `This will run\n\n  git push ${remote} :${branch}`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  // Delete via push refspec.
  await withBusy(() => ipc.remotePush(r, remote, `:${branch}`, false));
}

async function copyRemoteBranchLink(remote: string, branch: string) {
  const url = remoteUrlByName(remote);
  if (!url) { notifyError("Remote not found", remote); return; }
  const link = branchWebUrl(url, branch);
  if (!link) {
    notifyInfo("Unsupported remote", "Could not derive a web URL from the remote");
    return;
  }
  await copy(link, "branch URL");
}

// --- Branch (local) ---
export function localBranchMenu(branch: string, sha: string): MenuItem[] {
  return [
    // Group 1
    {
      label: "Pull (fast-forward if possible)",
      icon: "↓",
      onClick: async () => {
        const r = repo();
        if (!r) return;
        const before = get(graph)?.head_sha;
        const res = await runAction(`Pull ${branch}`, () =>
          ipc.remotePull(r, false),
        );
        if (!res.ok) {
          notifyError("Pull failed", res.error);
          return;
        }
        const after = get(graph)?.head_sha;
        if (before === after)
          notifyInfo(
            "Already Up-to-Date",
            `No merge necessary. Branch origin/${branch} was not moved.`,
          );
        else notifySuccess("Pulled Successfully");
      },
    },
    {
      label: "Push",
      icon: "↑",
      onClick: async () => {
        const r = repo();
        if (!r) return;
        const res = await runAction(`Push ${branch}`, () =>
          ipc.remotePush(r, "origin", branch, false),
        );
        if (res.ok) notifySuccess("Pushed Successfully", `${branch} → origin`);
        else notifyError("Push failed", res.error);
      },
    },
    { label: "Set Upstream", icon: "⇡", onClick: () => openSetUpstream(branch) },
    { separator: true, label: "" },
    // Group 2
    {
      label: `Checkout ${branch}`,
      icon: "✓",
      onClick: () => checkoutAndJump(branch),
    },
    { separator: true, label: "" },
    // Group 3
    {
      label: `Create worktree from ${branch}`,
      icon: "📂",
      onClick: () => openWorktreeCreate(branch, branch, false),
    },
    { separator: true, label: "" },
    // Group 4
    createBranchHereItem(sha),
    resetToCommitItem(sha),
    editCommitMessageItem(sha),
    revertCommitItem(sha),
    { separator: true, label: "" },
    // Group 6 (former Group 5 removed — "Explain Branch Changes" dropped)
    { label: "Apply patch", icon: "⌘", onClick: () => applyPatch() },
    {
      label: `Rename ${branch}`,
      icon: "✎",
      onClick: () => renameBranch(branch),
    },
    {
      label: `Delete ${branch}`,
      icon: "🗑",
      danger: true,
      onClick: () => deleteBranch(branch),
    },
    { separator: true, label: "" },
    // Group 7
    {
      label: "Copy branch name",
      icon: "⧉",
      onClick: () => copy(branch, "branch name"),
    },
    copyCommitShaItem(sha),
    copyCommitLinkItem(sha),
    { separator: true, label: "" },
    // Group 8 — view filters (hide / pin / solo). Labels flip to reflect
    // current state so the user always knows what the action will do.
    ...viewFilterItems(branch, branch),
    { separator: true, label: "" },
    // Group 9
    ...createTagHereItems(sha),
  ];
}

// --- Branch (remote) ---
export function remoteBranchMenu(
  remote: string,
  branch: string,
  sha: string,
): MenuItem[] {
  const full = `${remote}/${branch}`;
  return [
    // Group 1
    {
      label: `Checkout ${full}`,
      icon: "✓",
      onClick: () => checkoutRemoteAndJump(remote, branch),
    },
    { separator: true, label: "" },
    // Group 2
    {
      label: `Create worktree from ${full}`,
      icon: "📂",
      onClick: () => openWorktreeCreate(full, full, true),
    },
    { separator: true, label: "" },
    // Group 3
    createBranchHereItem(sha),
    resetToCommitItem(sha),
    editCommitMessageItem(sha),
    revertCommitItem(sha),
    { separator: true, label: "" },
    // Group 4 — GitHub PR creator. Opens github.com/<owner>/<repo>/compare
    // in the system browser; GitHub picks the base branch automatically.
    {
      label: "Start a pull request",
      icon: "↗",
      onClick: () => startPullRequest(branch),
    },
    { separator: true, label: "" },
    // Group 5
    {
      label: `Delete ${full}`,
      icon: "🗑",
      danger: true,
      onClick: () => deleteRemoteBranch(remote, branch),
    },
    { separator: true, label: "" },
    // Group 6
    {
      label: "Copy branch name",
      icon: "⧉",
      onClick: () => copy(full, "branch name"),
    },
    copyCommitShaItem(sha),
    {
      label: `Copy link to branch: ${full}`,
      icon: "⧉",
      onClick: () => copyRemoteBranchLink(remote, branch),
    },
    copyCommitLinkItem(sha),
    { separator: true, label: "" },
    // Group 7 — view filters; the qualified name is the remote-prefixed
    // form so a remote branch can be hidden without affecting its local.
    ...viewFilterItems(full, branch),
    { separator: true, label: "" },
    // Group 8
    ...createTagHereItems(sha),
  ];
}
