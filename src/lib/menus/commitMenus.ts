// --- Commit (graph row, no ref) ---

import type { MenuItem } from "$lib/stores/contextmenu";
import { ipc } from "$lib/ipc";
import { notifySuccess, notifyError } from "$lib/stores/notifications";
import {
  repo,
  runAction,
  stub,
  openWorktreeCreate,
  checkoutCommitItem,
  createBranchHereItem,
  cherryPickCommitItem,
  resetToCommitItem,
  revertCommitItem,
  copyCommitShaItem,
  copyCommitLinkItem,
  createTagHereItems,
} from "$lib/menus/menuActions";

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

export function commitMenu(sha: string): MenuItem[] {
  return [
    checkoutCommitItem(sha, "Checkout this commit"),
    { separator: true, label: "" },
    {
      label: "Create worktree from this commit",
      icon: "📂",
      onClick: () => openWorktreeCreate(sha, sha.slice(0, 7), false),
    },
    { separator: true, label: "" },
    createBranchHereItem(sha),
    cherryPickCommitItem(sha),
    resetToCommitItem(sha),
    revertCommitItem(sha),
    { separator: true, label: "" },
    copyCommitShaItem(sha),
    copyCommitLinkItem(sha),
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
    ...createTagHereItems(sha),
  ];
}
