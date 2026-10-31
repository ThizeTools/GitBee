// Shared building blocks for the ref and commit context menus: the action
// runner, clipboard copy, view-filter items, and the commit/branch/tag items
// that more than one menu offers. Menus import these instead of repeating the
// same MenuItem literals.

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
import { notifyError, notifyInfo } from "$lib/stores/notifications";
import { checkoutShaAutoStash, scrollGraphTo } from "$lib/stores/graphscroll";
import { get } from "svelte/store";
import { openModal } from "$lib/stores/modals";
import { commitWebUrl } from "$lib/github/url";
import {
  hiddenRefs, soloRefs, pinnedRef,
  hideRef, unhideRef, toggleSolo, togglePin,
} from "$lib/stores/graphFilter";

export function repo(): string | null {
  return get(currentRepo);
}

export function stub(name: string): () => void {
  return () => {
    logAppend("info", `${name} — not implemented yet`);
    notifyInfo("Not implemented", name);
  };
}

// Wrapped action that updates busy/error and emits structured logs.
// Use this instead of withBusy when the caller needs the actual error.
export async function runAction<T>(
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

export async function copy(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    logAppend("info", `copied ${label}: ${text}`);
  } catch (e) {
    logAppend("error", `clipboard: ${e}`);
  }
}

export function headBranch(): string {
  return get(graph)?.head_branch ?? "HEAD";
}

export function headSha(): string | null {
  return get(graph)?.head_sha ?? null;
}

function commitSubject(sha: string): string {
  const node = get(graph)?.nodes.find((n) => n.sha === sha);
  return node?.subject ?? "";
}

export function openEditCommitMessage(sha: string): void {
  openModal({ kind: "edit-commit-message", sha, current: commitSubject(sha) });
}

export function openWorktreeCreate(reference: string, refLabel: string, isRemoteBranch = false): void {
  openModal({ kind: "worktree-create", reference, refLabel, isRemoteBranch });
}

// Build the Hide / Solo / Pin trio for a given qualified ref name. Labels
// flip ("Hide" ⇄ "Show", "Solo" ⇄ "Exit solo", "Pin" ⇄ "Unpin") so the
// menu always tells the user the action it will perform — no ambiguity.
// `refLabel` is the human-friendly variant (e.g. "main" for "origin/main").
export function viewFilterItems(qualifiedName: string, refLabel: string): MenuItem[] {
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

// ----- helpers shared by builders -----

export async function createBranchAt(sha: string): Promise<void> {
  const r = repo();
  if (!r) return;
  const name = prompt("New branch name:");
  if (!name) return;
  await withBusy(() => ipc.branchCreate(r, name, sha));
  scrollGraphTo(sha);
}

export async function createTag(sha: string, annotated: boolean): Promise<void> {
  const r = repo();
  if (!r) return;
  const name = prompt("Tag name:");
  if (!name) return;
  const message = annotated
    ? prompt("Annotation message:") || undefined
    : undefined;
  await withBusy(() => ipc.tagCreate(r, name, sha, message));
}

export async function resetMenu(sha: string): Promise<void> {
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

// Resolve a remote URL by name from the loaded remotes list. Defaults to
// `origin` if no name is given (matches the menu's "Copy link to commit
// on remote: origin" wording).
export function remoteUrlByName(name = "origin"): string | null {
  const list = get(remotes);
  return list.find((r) => r.name === name)?.url ?? list[0]?.url ?? null;
}

export async function copyRemoteCommitLink(sha: string): Promise<void> {
  const url = remoteUrlByName("origin");
  if (!url) { notifyError("No remote", "Add an origin remote first"); return; }
  const link = commitWebUrl(url, sha);
  if (!link) {
    notifyInfo("Unsupported remote", "Could not derive a web URL from the remote");
    return;
  }
  await copy(link, "commit URL");
}

// ----- shared MenuItem builders -----

export function revertCommitItem(sha: string): MenuItem {
  return {
    label: "Revert commit",
    icon: "↶",
    onClick: () => {
      const r = repo();
      if (r && confirm(`Revert ${sha.slice(0, 7)}?`))
        withBusy(() => ipc.revert(r, sha, true));
    },
  };
}

export function cherryPickCommitItem(sha: string): MenuItem {
  return {
    label: "Cherry pick commit",
    icon: "⤴",
    onClick: () => {
      const r = repo();
      if (r && confirm(`Cherry-pick ${sha.slice(0, 7)}?`))
        withBusy(() => ipc.cherryPick(r, sha));
    },
  };
}

export function checkoutCommitItem(sha: string, label: string): MenuItem {
  return {
    label,
    icon: "✓",
    onClick: async () => {
      const r = repo();
      if (!r) return;
      const res = await checkoutShaAutoStash(r, sha);
      if (res !== true) notifyError("Checkout failed", `${sha.slice(0, 7)}: ${res}`);
    },
  };
}

export function createBranchHereItem(sha: string): MenuItem {
  return {
    label: "Create branch here",
    icon: "⎇",
    onClick: () => createBranchAt(sha),
  };
}

export function resetToCommitItem(sha: string): MenuItem {
  return {
    label: `Reset ${headBranch()} to this commit`,
    icon: "↺",
    onClick: () => resetMenu(sha),
  };
}

// Edit commit message is HEAD-only — amending older commits requires
// interactive rebase, intentionally out of scope.
export function editCommitMessageItem(sha: string): MenuItem {
  return {
    label: "Edit commit message",
    icon: "✎",
    disabled: sha !== headSha(),
    onClick: () => openEditCommitMessage(sha),
  };
}

export function copyCommitShaItem(sha: string): MenuItem {
  return {
    label: "Copy commit sha",
    icon: "⧉",
    onClick: () => copy(sha, "commit sha"),
  };
}

export function copyCommitLinkItem(sha: string): MenuItem {
  return {
    label: "Copy link to this commit on remote: origin",
    icon: "⧉",
    onClick: () => copyRemoteCommitLink(sha),
  };
}

export function createTagHereItems(sha: string): MenuItem[] {
  return [
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
