// Centralized context-menu builders for refs (branches/tags) and commits.
// Each builder returns a MenuItem[] that can be passed straight to openMenu.
//
// Some entries trigger features we haven't implemented yet (Pin to Left,
// Solo, Cloud Patch, GitHub PR review, etc.). These are wired to a single
// "stub" handler that logs to the application Logs panel — visible to the
// user — so the menu is fully populated and we can fill in real behavior
// incrementally without changing call sites.

import type { MenuItem } from "$lib/stores/contextmenu";
import { ipc } from "$lib/ipc";
import {
  withBusy,
  currentRepo,
  graph,
  busy,
  errorMessage,
  refreshActive,
} from "$lib/stores/repo";
import { logAppend, logAction, type ActionResult } from "$lib/stores/logs";
import {
  notifySuccess,
  notifyError,
  notifyInfo,
} from "$lib/stores/notifications";
import {
  checkoutAndJump,
  checkoutRemoteAndJump,
  scrollGraphTo,
} from "$lib/stores/graphscroll";
import { get } from "svelte/store";

function repo(): string | null {
  return get(currentRepo);
}

function stub(name: string): () => void {
  return () => {
    logAppend("info", `${name} — not implemented yet`);
    notifyInfo("Not implemented", name);
  };
}

// Wrapped action that updates busy/error and emits structured logs.
// Use this instead of withBusy when the caller needs the actual error.
async function runAction<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  busy.set(true);
  errorMessage.set(null);
  try {
    const r = await logAction(label, fn);
    if (r.ok) await refreshActive();
    else errorMessage.set(r.error);
    return r;
  } finally {
    busy.set(false);
  }
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    logAppend("info", `copied ${label}: ${text}`);
  } catch (e) {
    logAppend("error", `clipboard: ${e}`);
  }
}

function headBranch(): string {
  return get(graph)?.head_branch ?? "HEAD";
}

// --- Branch (local) ---
export function localBranchMenu(branch: string, sha: string): MenuItem[] {
  const head = headBranch();
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
    { label: "Set Upstream", icon: "⇡", onClick: stub("Set upstream") },
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
      onClick: stub("Create worktree"),
    },
    { separator: true, label: "" },
    // Group 4
    {
      label: "Create branch here",
      icon: "⎇",
      onClick: () => createBranchAt(sha),
    },
    {
      label: `Reset ${head} to this commit`,
      icon: "↺",
      onClick: () => resetMenu(sha),
    },
    {
      label: "Edit commit message",
      icon: "✎",
      onClick: stub("Edit commit message"),
    },
    {
      label: "Revert commit",
      icon: "↶",
      onClick: () => {
        const r = repo();
        if (r && confirm(`Revert ${sha.slice(0, 7)}?`))
          withBusy(() => ipc.revert(r, sha, true));
      },
    },
    { separator: true, label: "" },
    // Group 6 (former Group 5 removed — "Explain Branch Changes" dropped)
    { label: "Apply patch", icon: "⌘", onClick: stub("Apply patch") },
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
    {
      label: "Copy commit sha",
      icon: "⧉",
      onClick: () => copy(sha, "commit sha"),
    },
    {
      label: "Copy link to this commit on remote: origin",
      icon: "⧉",
      onClick: () => copyRemoteCommitLink(sha),
    },
    { separator: true, label: "" },
    // Group 8
    { label: "Hide", icon: "○", onClick: stub("Hide branch") },
    { label: "Pin to Left", icon: "📌", onClick: stub("Pin to left") },
    { label: "Solo", icon: "⊙", onClick: stub("Solo") },
    { separator: true, label: "" },
    // Group 9
    {
      label: "Create tag here",
      icon: "🏷",
      onClick: () => createTag(sha, false),
    },
    {
      label: "Create annotated tag here",
      icon: "🏷",
      onClick: () => createTag(sha, true),
    },
  ];
}

// --- Branch (remote) ---
export function remoteBranchMenu(
  remote: string,
  branch: string,
  sha: string,
): MenuItem[] {
  const full = `${remote}/${branch}`;
  const head = headBranch();
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
      onClick: stub("Create worktree"),
    },
    { separator: true, label: "" },
    // Group 3
    {
      label: "Create branch here",
      icon: "⎇",
      onClick: () => createBranchAt(sha),
    },
    {
      label: `Reset ${head} to this commit`,
      icon: "↺",
      onClick: () => resetMenu(sha),
    },
    {
      label: "Edit commit message",
      icon: "✎",
      onClick: stub("Edit commit message"),
    },
    {
      label: "Revert commit",
      icon: "↶",
      onClick: () => {
        const r = repo();
        if (r && confirm(`Revert ${sha.slice(0, 7)}?`))
          withBusy(() => ipc.revert(r, sha, true));
      },
    },
    { separator: true, label: "" },
    // Group 4 — GitHub-related (stubbed)
    {
      label: "Start a pull request",
      icon: "↗",
      onClick: stub("Open PR creator"),
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
    {
      label: "Copy commit sha",
      icon: "⧉",
      onClick: () => copy(sha, "commit sha"),
    },
    {
      label: `Copy link to branch: ${full}`,
      icon: "⧉",
      onClick: () => copyRemoteBranchLink(remote, branch),
    },
    {
      label: "Copy link to this commit on remote: origin",
      icon: "⧉",
      onClick: () => copyRemoteCommitLink(sha),
    },
    { separator: true, label: "" },
    // Group 7
    { label: "Hide", icon: "○", onClick: stub("Hide branch") },
    { label: "Pin to Left", icon: "📌", onClick: stub("Pin to left") },
    { label: "Solo", icon: "⊙", onClick: stub("Solo") },
    { separator: true, label: "" },
    // Group 8
    {
      label: "Create tag here",
      icon: "🏷",
      onClick: () => createTag(sha, false),
    },
    {
      label: "Create annotated tag here",
      icon: "🏷",
      onClick: () => createTag(sha, true),
    },
  ];
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
      onClick: stub("FF tag"),
    },
    {
      label: `Merge ${head} into ${tagName}`,
      icon: "⫶",
      onClick: stub("Merge tag"),
    },
    {
      label: `Rebase ${head} onto ${tagName}`,
      icon: "⇄",
      onClick: stub("Rebase onto tag"),
    },
    { separator: true, label: "" },
    // Group 3
    {
      label: `Checkout the commit at ${tagName}`,
      icon: "✓",
      onClick: () => {
        const r = repo();
        if (r) withBusy(() => ipc.checkoutSha(r, sha));
      },
    },
    { separator: true, label: "" },
    // Group 5 (former Group 4 removed — "Explain Branch Changes" dropped)
    {
      label: "Create branch here",
      icon: "⎇",
      onClick: () => createBranchAt(sha),
    },
    {
      label: "Cherry pick commit",
      icon: "⤴",
      onClick: () => {
        const r = repo();
        if (r && confirm(`Cherry-pick ${sha.slice(0, 7)}?`))
          withBusy(() => ipc.cherryPick(r, sha));
      },
    },
    {
      label: `Reset ${head} to this commit`,
      icon: "↺",
      onClick: () => resetMenu(sha),
    },
    {
      label: "Revert commit",
      icon: "↶",
      onClick: () => {
        const r = repo();
        if (r && confirm(`Revert ${sha.slice(0, 7)}?`))
          withBusy(() => ipc.revert(r, sha, true));
      },
    },
    { separator: true, label: "" },
    // Group 6
    {
      label: `Delete ${tagName} locally`,
      icon: "🗑",
      danger: true,
      onClick: () => {
        const r = repo();
        if (r && confirm(`Delete tag ${tagName}?`))
          withBusy(() => ipc.tagDelete(r, tagName));
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
    // Group 8
    { label: "Hide", icon: "○", onClick: stub("Hide tag") },
    { label: "Solo", icon: "⊙", onClick: stub("Solo") },
    { separator: true, label: "" },
    // Group 9
    { label: `Annotate ${tagName}`, icon: "✎", onClick: stub("Annotate tag") },
  ];
}

// --- Commit (graph row, no ref) ---
export function commitMenu(sha: string): MenuItem[] {
  const head = headBranch();
  return [
    {
      label: "Checkout this commit",
      icon: "✓",
      onClick: () => {
        const r = repo();
        if (r) withBusy(() => ipc.checkoutSha(r, sha));
      },
    },
    { separator: true, label: "" },
    {
      label: "Create worktree from this commit",
      icon: "📂",
      onClick: stub("Create worktree"),
    },
    { separator: true, label: "" },
    {
      label: "Create branch here",
      icon: "⎇",
      onClick: () => createBranchAt(sha),
    },
    {
      label: "Cherry pick commit",
      icon: "⤴",
      onClick: () => {
        const r = repo();
        if (r && confirm(`Cherry-pick ${sha.slice(0, 7)}?`))
          withBusy(() => ipc.cherryPick(r, sha));
      },
    },
    {
      label: `Reset ${head} to this commit`,
      icon: "↺",
      onClick: () => resetMenu(sha),
    },
    {
      label: "Revert commit",
      icon: "↶",
      onClick: () => {
        const r = repo();
        if (r && confirm(`Revert ${sha.slice(0, 7)}?`))
          withBusy(() => ipc.revert(r, sha, true));
      },
    },
    { separator: true, label: "" },
    {
      label: "Copy commit sha",
      icon: "⧉",
      onClick: () => copy(sha, "commit sha"),
    },
    {
      label: "Copy link to this commit on remote: origin",
      icon: "⧉",
      onClick: () => copyRemoteCommitLink(sha),
    },
    {
      label: "Create patch from commit",
      icon: "⌘",
      onClick: stub("Create patch"),
    },
    {
      label: "Share commit as Cloud Patch",
      icon: "☁",
      onClick: stub("Cloud Patch"),
    },
    { separator: true, label: "" },
    {
      label: "Create tag here",
      icon: "🏷",
      onClick: () => createTag(sha, false),
    },
    {
      label: "Create annotated tag here",
      icon: "🏷",
      onClick: () => createTag(sha, true),
    },
  ];
}

// ----- helpers shared by builders -----

async function createBranchAt(sha: string) {
  const r = repo();
  if (!r) return;
  const name = prompt("New branch name:");
  if (!name) return;
  await withBusy(() => ipc.branchCreate(r, name, sha));
  scrollGraphTo(sha);
}

async function renameBranch(oldName: string) {
  const r = repo();
  if (!r) return;
  const name = prompt(`Rename branch "${oldName}" to:`, oldName);
  if (!name || name === oldName) return;
  await withBusy(() => ipc.branchRename(r, oldName, name));
}

async function deleteBranch(name: string) {
  const r = repo();
  if (!r) return;
  if (!confirm(`Delete local branch "${name}"?`)) return;
  await withBusy(() => ipc.branchDelete(r, name, false));
}

async function deleteRemoteBranch(remote: string, branch: string) {
  const r = repo();
  if (!r) return;
  if (
    !confirm(
      `Delete remote branch ${remote}/${branch}? This will run\n\n  git push ${remote} :${branch}`,
    )
  )
    return;
  // Delete via push refspec.
  await withBusy(() => ipc.remotePush(r, remote, `:${branch}`, false));
}

async function createTag(sha: string, annotated: boolean) {
  const r = repo();
  if (!r) return;
  const name = prompt("Tag name:");
  if (!name) return;
  const message = annotated
    ? prompt("Annotation message:") || undefined
    : undefined;
  await withBusy(() => ipc.tagCreate(r, name, sha, message));
}

async function resetMenu(sha: string) {
  const r = repo();
  if (!r) return;
  // Lightweight three-choice via prompt — full submenu would be ideal but
  // openMenu doesn't nest deeply enough for our needs here.
  const mode = prompt(
    `Reset mode? Type one of: soft, mixed, hard\n(target: ${sha.slice(0, 7)})`,
    "mixed",
  );
  if (!mode) return;
  if (!["soft", "mixed", "hard"].includes(mode)) {
    logAppend("warn", `unknown reset mode "${mode}"`);
    return;
  }
  if (
    mode === "hard" &&
    !confirm(
      `Reset --hard to ${sha.slice(0, 7)}?\nThis discards working-tree changes.`,
    )
  )
    return;
  await withBusy(() => ipc.reset(r, sha, mode as "soft" | "mixed" | "hard"));
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

export async function refreshRemoteTags() {
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

async function copyRemoteCommitLink(sha: string) {
  // We don't have the origin URL in the frontend; fall back to copying sha
  // and a hint. (TODO: add an ipc.remoteUrl call.)
  await copy(`<origin>/commit/${sha}`, "commit URL template");
}
async function copyRemoteBranchLink(remote: string, branch: string) {
  await copy(`<${remote}>/tree/${branch}`, "branch URL template");
}
