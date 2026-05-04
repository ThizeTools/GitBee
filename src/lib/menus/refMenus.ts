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
  remotes,
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
import { openModal } from "$lib/stores/modals";
import { pullRequestCompareUrl, commitWebUrl, branchWebUrl } from "$lib/github/url";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  hiddenRefs, soloRefs, pinnedRef,
  hideRef, unhideRef, toggleSolo, togglePin,
} from "$lib/stores/graphFilter";

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

function headSha(): string | null {
  return get(graph)?.head_sha ?? null;
}

function commitSubject(sha: string): string {
  const node = get(graph)?.nodes.find((n) => n.sha === sha);
  return node?.subject ?? "";
}

function originUrl(): string | null {
  const list = get(remotes);
  const origin = list.find((r) => r.name === "origin") ?? list[0];
  return origin?.url ?? null;
}

function openEditCommitMessage(sha: string): void {
  openModal({ kind: "edit-commit-message", sha, current: commitSubject(sha) });
}

function openSetUpstream(branch: string): void {
  openModal({ kind: "set-upstream", branch });
}

function openWorktreeCreate(reference: string, refLabel: string, isRemoteBranch = false): void {
  openModal({ kind: "worktree-create", reference, refLabel, isRemoteBranch });
}

// Fire the "Start a pull request" flow by opening GitHub's compare page
// for the given branch in the system browser. GitHub auto-picks the base
// (the repo's default branch) and `?expand=1` lands the user on the PR
// creation form. Falls back to a notification when the remote isn't on
// github.com or we don't have an origin URL.
// Build the Hide / Solo / Pin trio for a given qualified ref name. Labels
// flip ("Hide" ⇄ "Show", "Solo" ⇄ "Exit solo", "Pin" ⇄ "Unpin") so the
// menu always tells the user the action it will perform — no ambiguity.
// `refLabel` is the human-friendly variant (e.g. "main" for "origin/main").
function viewFilterItems(qualifiedName: string, refLabel: string): MenuItem[] {
  const hidden = get(hiddenRefs).has(qualifiedName);
  const solo = get(soloRefs);
  const isSolo = solo.has(qualifiedName);
  const pinned = get(pinnedRef) === qualifiedName;
  // When already soloing other refs, label changes to "Add to solo" so
  // the user knows clicking will INCLUDE this branch in the current
  // solo selection rather than replacing it. Removing the last solo'd
  // ref naturally exits solo mode.
  let soloLabel: string;
  if (isSolo) soloLabel = "Remove from solo";
  else if (solo.size > 0) soloLabel = "Add to solo";
  else soloLabel = "Solo";
  return [
    {
      label: hidden ? `Show ${refLabel}` : "Hide",
      icon: hidden ? "◐" : "○",
      onClick: () => (hidden ? unhideRef(qualifiedName) : hideRef(qualifiedName)),
    },
    {
      label: pinned ? "Unpin" : "Pin to Left",
      icon: "📌",
      onClick: () => togglePin(qualifiedName),
    },
    {
      label: soloLabel,
      icon: "⊙",
      onClick: () => toggleSolo(qualifiedName),
    },
  ];
}

// `git tag -f <name> <head_sha>`. We resolve HEAD up-front so the
// command shows a precise label in logs and the destructive nature of
// `-f` is visible to the user via the confirm prompt.
async function fastForwardTag(tagName: string): Promise<void> {
  const r = repo();
  const head = headSha();
  if (!r || !head) return;
  if (!confirm(`Fast-forward ${tagName} to ${head.slice(0, 7)}?\n\nThis rewrites the tag and may need a force-push.`)) return;
  const res = await runAction(`FF tag ${tagName}`, () =>
    ipc.tagMove(r, tagName, head),
  );
  if (res.ok) notifySuccess("Tag moved", `${tagName} → ${head.slice(0, 7)}`);
  else notifyError("FF tag failed", res.error);
}

// Lightweight tag → annotated tag (or change an existing message).
// Prompt is a plain `prompt()` because the message is single-line for
// most workflows; if it grows we'll swap for a modal.
async function annotateTag(tagName: string): Promise<void> {
  const r = repo();
  if (!r) return;
  const message = prompt(`Annotation message for ${tagName}:`);
  if (message === null || message.trim() === "") return;
  const res = await runAction(`Annotate ${tagName}`, () =>
    ipc.tagAnnotate(r, tagName, message.trim()),
  );
  if (res.ok) notifySuccess("Tag annotated", tagName);
  else notifyError("Annotate failed", res.error);
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

// Pick a folder, then `git format-patch -1 <sha> -o <folder>`. The
// resulting `.patch` is suitable for emailing or feeding back through
// "Apply patch".
async function createPatch(sha: string): Promise<void> {
  const r = repo();
  if (!r) return;
  const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
  const picked = await openDialog({
    directory: true, multiple: false,
    title: "Folder to write the patch into",
  });
  if (typeof picked !== "string") return;
  const res = await runAction(`Create patch ${sha.slice(0, 7)}`, () =>
    ipc.commitFormatPatch(r, sha, picked),
  );
  if (res.ok) notifySuccess("Patch created", res.value as string);
  else notifyError("Create patch failed", res.error);
}

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
    // Edit commit message is HEAD-only — amending older commits requires
    // interactive rebase, intentionally out of scope.
    {
      label: "Edit commit message",
      icon: "✎",
      disabled: sha !== headSha(),
      onClick: () => openEditCommitMessage(sha),
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
    // Group 8 — view filters (hide / pin / solo). Labels flip to reflect
    // current state so the user always knows what the action will do.
    ...viewFilterItems(branch, branch),
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
      onClick: () => openWorktreeCreate(full, full, true),
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
      disabled: sha !== headSha(),
      onClick: () => openEditCommitMessage(sha),
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
    // Group 7 — view filters; the qualified name is the remote-prefixed
    // form so a remote branch can be hidden without affecting its local.
    ...viewFilterItems(full, branch),
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
      onClick: () => fastForwardTag(tagName),
    },
    {
      label: `Merge ${tagName} into ${head}`,
      icon: "⫶",
      onClick: async () => {
        const r = repo();
        if (!r) return;
        if (!confirm(`Merge ${tagName} into ${head}?`)) return;
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
        if (!confirm(`Rebase ${head} onto ${tagName}?`)) return;
        const res = await runAction(`Rebase ${head} onto ${tagName}`, () =>
          ipc.branchRebase(r, tagName),
        );
        if (res.ok) notifySuccess("Rebased", `${head} onto ${tagName}`);
        else notifyError("Rebase failed", res.error);
      },
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
      onClick: () => openWorktreeCreate(sha, sha.slice(0, 7), false),
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
      onClick: () => createPatch(sha),
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

// Resolve a remote URL by name from the loaded remotes list. Defaults to
// `origin` if no name is given (matches the menu's "Copy link to commit
// on remote: origin" wording).
function remoteUrlByName(name = "origin"): string | null {
  const list = get(remotes);
  return list.find((r) => r.name === name)?.url ?? list[0]?.url ?? null;
}

async function copyRemoteCommitLink(sha: string) {
  const url = remoteUrlByName("origin");
  if (!url) { notifyError("No remote", "Add an origin remote first"); return; }
  const link = commitWebUrl(url, sha);
  if (!link) {
    notifyInfo("Unsupported remote", "Could not derive a web URL from the remote");
    return;
  }
  await copy(link, "commit URL");
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
