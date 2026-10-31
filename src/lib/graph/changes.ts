// Changes column: the bar, the labels, the window of rows whose stats are
// requested, and the stat each cell paints. Pure. ChangesCell paints the result
// and GraphCanvas feeds it the window. See docs/specs/graph-columns-and-markers.md.
import type { CommitStat } from "$lib/ipc";
import type { StatsLookup } from "$lib/stores/commitStatsCache";

// A commit with 10^3 changed lines fills the bar. A log scale keeps a 3-line fix
// and a 300-line change both readable; only very large commits reach the cap.
export const CHANGES_BAR_LOG_FULL = 3;
// Rows requested past each edge of the visible window, so a short scroll finds
// its stats already loaded.
export const CHANGES_OVERSCAN_ROWS = 20;

type LineCounts = Pick<CommitStat, "additions" | "deletions">;

export interface ChangesBar {
  // Bar length as a share of the cell width, 0 to 100.
  widthPct: number;
  // Green (additions) share of the bar, 0 to 100. The rest of the bar is red.
  addPct: number;
}

export function changesBar(stat: LineCounts): ChangesBar {
  const total = stat.additions + stat.deletions;
  if (total === 0) return { widthPct: 0, addPct: 0 };
  const scaled = (Math.log10(total + 1) / CHANGES_BAR_LOG_FULL) * 100;
  return {
    widthPct: Math.min(100, scaled),
    addPct: (stat.additions / total) * 100,
  };
}

// The minus is U+2212, as in the WIP breakdown, so the two read the same.
export function changesLabel(stat: LineCounts): string {
  return `+${stat.additions} −${stat.deletions}`;
}

export function changesTitle(stat: Pick<CommitStat, "files">): string {
  return stat.files === 1 ? "1 file" : `${stat.files} files`;
}

// Shas whose stats the visible window needs. Row r is node r minus the WIP
// shift. Stash rows are skipped: they paint an empty cell, so asking git about
// them would waste a call.
export function visibleStatShas(
  nodes: readonly { readonly sha: string }[],
  rowStart: number,
  rowEnd: number,
  wipShift: number,
  stashShas: ReadonlyMap<string, number>,
): string[] {
  const from = Math.max(0, rowStart - CHANGES_OVERSCAN_ROWS - wipShift);
  const to = Math.min(nodes.length, rowEnd + CHANGES_OVERSCAN_ROWS - wipShift);
  const out: string[] = [];
  for (let i = from; i < to; i++) {
    if (!stashShas.has(nodes[i].sha)) out.push(nodes[i].sha);
  }
  return out;
}

// What a row's cell paints: null for an empty cell (the WIP row has no node, and
// stash rows have none either), undefined for the loading placeholder, else the stat.
export function changesStatFor(
  node: { readonly sha: string } | null,
  stashShas: ReadonlyMap<string, number>,
  lookup: StatsLookup,
): CommitStat | null | undefined {
  if (node === null || stashShas.has(node.sha)) return null;
  return lookup.get(node.sha);
}
