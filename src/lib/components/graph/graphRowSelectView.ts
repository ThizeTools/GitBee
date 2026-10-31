// Store wiring for toggleRowSelection; graphRowSelect.ts stays store-free so
// bun tests can load it.
import { selectedSha } from "$lib/stores/repo";
import { showCommit, showStash, showChanges, clearSelection } from "$lib/stores/rightpanel";
import { setSize } from "$lib/stores/layout";
import type { RowSelectionView, RowTarget } from "./graphRowSelect";

// WIP opens the Changes view, a stash its stash details, a commit its details.
function showRowDetails(target: RowTarget): void {
  if (target.isWip) showChanges();
  else if (target.stashIndex !== null) showStash(target.stashIndex);
  else showCommit(target.sha);
}

export const rightPanelRowView: RowSelectionView = {
  select: (sha) => selectedSha.set(sha),
  showDetails: showRowDetails,
  clearDetails: clearSelection,
  setPanelCollapsed: (collapsed) => setSize("rightPanelCollapsed", collapsed),
};
