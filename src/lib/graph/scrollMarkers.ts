// Scroll-strip markers: where HEAD, the selection, branch tips, stashes and
// search matches sit in the full row list. Pure: the component owns the
// canvas and the DOM, this module owns which rows get a mark and how thick.
// See docs/specs/graph-columns-and-markers.md (invariant: markers are derived
// from data inputs only, never from scroll position).
import type { CommitRef, GraphNode } from "$lib/ipc";
import { laneColor } from "./renderer";

export type MarkerKind = "match" | "stash" | "branch" | "selected" | "head";

export interface Marker {
  kind: MarkerKind;
  // Display row, WIP row included (row 0 when WIP is shown).
  row: number;
  // Explicit color (a branch tip carries its lane color); null means the
  // component picks the theme color for `kind`.
  color: string | null;
  // Mark height in CSS px.
  thickness: number;
}

export interface BranchTipRow { row: number; color: string }

export interface MarkerInput {
  totalRows: number;
  headRow: number | null;
  selectedRow: number | null;
  branchTipRows: readonly BranchTipRow[];
  // Display rows (node index + row offset), not node indices.
  stashRows: readonly number[];
  matchRows: readonly number[];
}

// Draw order is priority: later kinds paint over earlier ones that land on the
// same pixel, so HEAD always stays visible on top of a search match.
const THICKNESS: Record<MarkerKind, number> = {
  match: 1, stash: 2, branch: 2, selected: 2, head: 3,
};

function mark(kind: MarkerKind, row: number, color: string | null, totalRows: number): Marker | null {
  if (row < 0 || row >= totalRows) return null;
  return { kind, row, color, thickness: THICKNESS[kind] };
}

// Markers in draw order. Rows outside [0, totalRows) are dropped rather than
// clamped: a stale index would otherwise paint a mark at the wrong row.
export function markerRows(input: MarkerInput): Marker[] {
  const out: Marker[] = [];
  const add = (m: Marker | null): void => { if (m) out.push(m); };
  const t = input.totalRows;
  for (const row of input.matchRows) add(mark("match", row, null, t));
  for (const row of input.stashRows) add(mark("stash", row, null, t));
  for (const tip of input.branchTipRows) add(mark("branch", tip.row, tip.color, t));
  if (input.selectedRow !== null) add(mark("selected", input.selectedRow, null, t));
  if (input.headRow !== null) add(mark("head", input.headRow, null, t));
  return out;
}

// Row of the marker closest to `rowAt` (a fractional display row under the
// pointer), or null when nothing is marked. A strip click jumps to this row.
export function nearestMarkerRow(markers: readonly Marker[], rowAt: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const m of markers) {
    const dist = Math.abs(m.row - rowAt);
    if (dist < bestDist) { bestDist = dist; best = m.row; }
  }
  return best;
}

export interface MarkerSource {
  nodes: readonly GraphNode[];
  shaToRow: ReadonlyMap<string, number>;
  wipVisible: boolean;
  headSha: string | null;
  selectedSha: string | null;
  wipSha: string;
  refsByCommit: ReadonlyMap<string, readonly CommitRef[]>;
  // Node indices of stash commits (same set GraphCanvas already builds).
  stashRows: ReadonlySet<number>;
  matchShas: readonly string[];
}

// Converts graph data into display-row inputs. The WIP offset is applied here
// and nowhere else, so a row number means the same thing to every marker.
export function buildMarkerInput(src: MarkerSource): MarkerInput {
  const offset = src.wipVisible ? 1 : 0;
  return {
    totalRows: src.nodes.length + offset,
    headRow: rowOfSha(src.headSha, src.shaToRow, offset),
    selectedRow: selectedRowOf(src, offset),
    branchTipRows: branchTipRows(src.nodes, src.refsByCommit, offset),
    stashRows: [...src.stashRows].map((r) => r + offset),
    matchRows: src.matchShas.flatMap((sha) => {
      const row = rowOfSha(sha, src.shaToRow, offset);
      return row === null ? [] : [row];
    }),
  };
}

function rowOfSha(sha: string | null, shaToRow: ReadonlyMap<string, number>, offset: number): number | null {
  if (sha === null) return null;
  const idx = shaToRow.get(sha);
  return idx === undefined ? null : idx + offset;
}

// The WIP row is selectable but not a node, so it has no entry in shaToRow;
// it maps to display row 0 only while it is shown.
function selectedRowOf(src: MarkerSource, offset: number): number | null {
  if (src.selectedSha === src.wipSha) return src.wipVisible ? 0 : null;
  return rowOfSha(src.selectedSha, src.shaToRow, offset);
}

function branchTipRows(
  nodes: readonly GraphNode[],
  refsByCommit: ReadonlyMap<string, readonly CommitRef[]>,
  offset: number,
): BranchTipRow[] {
  const out: BranchTipRow[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const refs = refsByCommit.get(nodes[i].sha) ?? [];
    if (refs.some((r) => r.kind === "localbranch")) {
      out.push({ row: i + offset, color: laneColor(nodes[i].lane) });
    }
  }
  return out;
}
