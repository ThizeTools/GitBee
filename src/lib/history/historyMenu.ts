// Context menu items for one commit row of the file history. Pure: the actions
// are passed in, so the menu can be built and tested without the stores.
import type { MenuItem } from "$lib/stores/contextmenu";
import type { FileLogEntry } from "$lib/ipc";

/** What a history row can do. The concrete versions live in historyActions.ts. */
export interface HistoryActions {
  showInGraph(sha: string): void;
  blameAt(path: string, sha: string): void;
  copySha(sha: string): void;
}

/**
 * Items for one commit. "Blame at this commit" uses the path the file had in
 * that commit, so a file renamed later is still blamed under its old name.
 * Usage: historyMenu(entry, actions)[0].label is "Show in graph".
 */
export function historyMenu(entry: FileLogEntry, actions: HistoryActions): MenuItem[] {
  return [
    { label: "Show in graph", icon: "eye",onClick: () => actions.showInGraph(entry.sha) },
    {
      label: "Blame at this commit",
      icon: "logs",
      onClick: () => actions.blameAt(entry.path_at_commit, entry.sha),
    },
    { label: "Copy sha", icon: "copy",onClick: () => actions.copySha(entry.sha) },
  ];
}
