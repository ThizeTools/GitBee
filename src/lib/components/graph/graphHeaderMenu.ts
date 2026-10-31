// Right-click menu on the graph header: one checkbox-like row per column plus
// the merge-dimming toggle. Pure: GraphHeader supplies the state and handlers.
import type { MenuItem } from "$lib/stores/contextmenu";
import { isLockedCol, type GraphCol } from "$lib/graph/columns";

// Menu labels in Title Case; header titles stay uppercase (GraphHeader).
export const COL_MENU_LABEL: Record<GraphCol, string> = {
  refs: "Branch / tag",
  graph: "Graph",
  msg: "Commit message",
  author: "Author",
  date: "Date",
  sha: "SHA",
};

export interface ColumnMenuOptions {
  order: readonly GraphCol[];
  hidden: readonly GraphCol[];
  dimMerges: boolean;
  onToggleHidden: (col: GraphCol) => void;
  onToggleDim: () => void;
}

const CHECKED = "✓ ";
const UNCHECKED = "   ";

function check(on: boolean): string {
  return on ? CHECKED : UNCHECKED;
}

// Locked columns are listed (checked, disabled) so the user can see why they
// cannot be hidden, rather than finding them missing from the menu.
export function columnMenuItems(opts: ColumnMenuOptions): MenuItem[] {
  const columns: MenuItem[] = opts.order.map((col) => ({
    label: `${check(!opts.hidden.includes(col))}${COL_MENU_LABEL[col]}`,
    disabled: isLockedCol(col),
    onClick: () => opts.onToggleHidden(col),
  }));
  return [
    ...columns,
    { label: "", separator: true },
    {
      label: `${check(opts.dimMerges)}Dim merge commits`,
      onClick: opts.onToggleDim,
    },
  ];
}
