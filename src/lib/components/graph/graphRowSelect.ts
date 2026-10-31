// Click-toggle on a graph row, moved out of GraphCanvas.svelte (500-line
// limit). Pure: every effect goes through `view`, so tests drive it with a
// fake and graphRowSelectView.ts wires it to the stores.

/** A clicked row: the synthetic WIP row, a stash, or a plain commit. */
export interface RowTarget {
  sha: string;
  isWip: boolean;
  stashIndex: number | null;
}

/** Everything a row click can change. */
export interface RowSelectionView {
  select(sha: string | null): void;
  showDetails(target: RowTarget): void;
  clearDetails(): void;
  setPanelCollapsed(collapsed: boolean): void;
}

/** Clicking the already-selected row deselects it and collapses the right
 * panel. Clicking any other row selects it, shows it in the right panel and
 * expands the panel back open.
 * Example: `toggleRowSelection({ sha, isWip: false, stashIndex: null }, $selectedSha, rightPanelRowView)` */
export function toggleRowSelection(
  target: RowTarget,
  current: string | null,
  view: RowSelectionView,
): void {
  if (current === target.sha) {
    view.select(null);
    view.clearDetails();
    view.setPanelCollapsed(true);
    return;
  }
  view.select(target.sha);
  view.showDetails(target);
  view.setPanelCollapsed(false);
}
