// Right-click menu on the graph header: one checkbox-like row per column plus
// the merge-dimming toggle. Pure: GraphHeader supplies the state and handlers.
import type { MenuItem } from "$lib/stores/contextmenu";
import type { IconName } from "$lib/icons/names";
import { isLockedCol, type GraphCol } from "$lib/graph/columns";

// Menu labels in Title Case; header titles stay uppercase (GraphHeader).
export const COL_MENU_LABEL: Record<GraphCol, string> = {
  refs: "Branch / tag",
  graph: "Graph",
  msg: "Commit message",
  author: "Author",
  date: "Date",
  sha: "SHA",
  changes: "Changes",
};

export interface ColumnMenuOptions {
  order: readonly GraphCol[];
  hidden: readonly GraphCol[];
  dimMerges: boolean;
  onToggleHidden: (col: GraphCol) => void;
  onToggleDim: () => void;
}

// A checked row shows the check icon; an unchecked row has no icon. The menu
// reserves the icon column on every row, so the labels still line up.
function checkIcon(on: boolean): IconName | undefined {
  return on ? "check" : undefined;
}

// Locked columns are listed (checked, disabled) so the user can see why they
// cannot be hidden, rather than finding them missing from the menu.
export function columnMenuItems(opts: ColumnMenuOptions): MenuItem[] {
  const columns: MenuItem[] = opts.order.map((col) => ({
    label: COL_MENU_LABEL[col],
    icon: checkIcon(!opts.hidden.includes(col)),
    disabled: isLockedCol(col),
    onClick: () => opts.onToggleHidden(col),
  }));
  return [
    ...columns,
    { label: "", separator: true },
    {
      label: "Dim merge commits",
      icon: checkIcon(opts.dimMerges),
      onClick: opts.onToggleDim,
    },
  ];
}
