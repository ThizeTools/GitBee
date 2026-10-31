import type { MenuItem } from "$lib/stores/contextmenu";
import { showConflict } from "$lib/stores/center";
import { markResolved, takeSide } from "$lib/conflict/actions";
import { takeLabel, type SideNames } from "$lib/conflict/labels";
import { editFile } from "./fileActions";

/**
 * Right-click menu for one conflicted file. The side names come from the
 * running op, so a rebase menu says "Base (onto)" where a merge says "Mine".
 *
 * @example conflictContextMenu("a.ts", sideNames("merge"))[0].label // "Take mine"
 */
export function conflictContextMenu(path: string, names: SideNames): MenuItem[] {
  return [
    {
      label: takeLabel("ours", names),
      icon: "branch",
      onClick: () => takeSide(path, "ours", names.ours),
    },
    {
      label: takeLabel("theirs", names),
      icon: "merge",
      onClick: () => takeSide(path, "theirs", names.theirs),
    },
    { label: "Resolve…", icon: "conflict", onClick: () => showConflict(path) },
    { separator: true, label: "" },
    { label: "Mark resolved", icon: "check", onClick: () => markResolved(path) },
    { label: "Open in external editor", icon: "external", onClick: () => editFile(path) },
  ];
}
