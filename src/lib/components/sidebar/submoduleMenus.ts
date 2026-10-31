// Context menus for the Submodules section: one for a row, one for the header.
// Actions go through stores/submodules.ts; this file only lists them.
import { ipc, type Submodule } from "$lib/ipc";
import type { MenuItem } from "$lib/stores/contextmenu";
import { errorMessage } from "$lib/stores/repo";
import {
  addSubmodule, joinRepoPath, openSubmoduleTab, syncSubmoduleUrls,
  updateAllSubmodules, updateSubmodule,
} from "$lib/stores/submodules";

/** Menu for one submodule row. Sync covers every submodule, since git syncs URLs
 * for the whole repo at once.
 * Example: openMenu(e, submoduleMenu(repo, sub)) */
export function submoduleMenu(repo: string, sub: Submodule): MenuItem[] {
  return [
    { label: "Update", icon: "↻", onClick: () => void updateSubmodule(repo, sub, false) },
    { label: "Update (init)", icon: "⤓", onClick: () => void updateSubmodule(repo, sub, true) },
    { label: "Sync URLs", icon: "⇄", onClick: () => void syncSubmoduleUrls(repo) },
    { separator: true, label: "" },
    { label: "Open in new tab", icon: "⧉", onClick: () => void openSubmoduleTab(repo, sub) },
    {
      label: "Open folder", icon: "📂",
      onClick: () => void ipc.fileShowInFolder(repo, sub.path).catch((e) => errorMessage.set(String(e))),
    },
    {
      label: "Copy path", icon: "⎘",
      onClick: () => void copyPath(joinRepoPath(repo, sub.path)),
    },
  ];
}

/** Menu for the section header: whole-repo actions.
 * Example: openMenu(e, submoduleHeaderMenu(repo)) */
export function submoduleHeaderMenu(repo: string): MenuItem[] {
  return [
    { label: "Update all (init, recursive)", icon: "↻", onClick: () => void updateAllSubmodules(repo) },
    { label: "Add submodule…", icon: "+", onClick: () => void addSubmodule(repo) },
  ];
}

/** Writes `text` to the clipboard, reporting a failure in the error bar. */
async function copyPath(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    errorMessage.set(`Could not copy the path: ${String(e)}`);
  }
}
