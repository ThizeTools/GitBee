import { get } from "svelte/store";
import { graph, selectedSha, visibleGraphNodes } from "$lib/stores/repo";
import { showCommit } from "$lib/stores/rightpanel";
import { graphScrollTarget } from "$lib/stores/graphscroll";
import { notifyInfo } from "$lib/stores/notifications";
import { ROW_HEIGHT } from "$lib/graph/layout";
import {
  nextRowIndex, pageRowCount, upstreamSha,
  type GraphKeyAction, type RowMove,
} from "$lib/stores/graphKeys";

// Store side of the graph shortcuts. Selection goes through the same three
// writes as a mouse pick (selectedSha, showCommit, graphScrollTarget); the
// scroll target is what makes GraphCanvas bring the row into view.

/** Runs one graph key action against the stores. Example: runGraphKeyAction({ kind: "head" }) */
export function runGraphKeyAction(action: GraphKeyAction): void {
  if (action.kind === "move") {
    moveRow(action.move);
    return;
  }
  const g = get(graph);
  if (!g) return;
  if (action.kind === "head") {
    if (!g.head_sha) return notifyInfo("No HEAD commit", "This repository has no commits yet.");
    if (!selectRow(g.head_sha)) notifyHidden("HEAD");
    return;
  }
  const sha = upstreamSha(g.refs, g.head_branch);
  if (!sha) return notifyInfo("No upstream commit", "The upstream of HEAD is not in the loaded history.");
  if (!selectRow(sha)) notifyHidden("The upstream");
}

// A commit hidden or soloed away has no row, so selecting it would silently
// fail to scroll. Say so instead.
function notifyHidden(label: string): void {
  notifyInfo("Commit not shown", `${label} is hidden by the graph filter.`);
}

// Returns false (and changes nothing) when the sha has no visible row.
function selectRow(sha: string): boolean {
  if (!get(visibleGraphNodes).some((n) => n.sha === sha)) return false;
  selectedSha.set(sha);
  showCommit(sha);
  graphScrollTarget.set(sha);
  return true;
}

function moveRow(move: RowMove): void {
  const nodes = get(visibleGraphNodes);
  const cur = nodes.findIndex((n) => n.sha === get(selectedSha));
  const page = pageRowCount(window.innerHeight, ROW_HEIGHT);
  const next = nextRowIndex(move, cur, nodes.length, page);
  if (next < 0 || next === cur) return;
  selectRow(nodes[next].sha);
}
