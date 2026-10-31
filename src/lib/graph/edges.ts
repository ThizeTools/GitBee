import type { GraphNode } from "$lib/ipc";

export type SegmentKind = "pass" | "in" | "out";

/** One piece of graph line inside a single row. `pass` crosses the row in
 * its lane; `in` comes from the top and ends at the row's node; `out`
 * leaves the node into its lane and goes down. */
export interface RowSegment {
  kind: SegmentKind;
  lane: number;
  dashed: boolean;
}

interface LaneTenant {
  sha: string;
  dashed: boolean;
}

/** Per-row line segments for the commit graph, replaying the backend's lane
 * reservations (`parent_lanes[k]` carries `parents[k]`) over the rows that
 * are actually displayed. Each row is self-contained, so the renderer draws
 * only visible rows and never scans from row 0 to keep long edges visible.
 * Parents not in `nodes` (beyond the load limit, or filtered out) start no
 * line. See docs/specs/graph-visual-2026-10.md.
 * Example: `const segs = buildRowSegments(nodes, stashRows); segs[r]` */
export function buildRowSegments(nodes: GraphNode[], stashRows: Set<number>): RowSegment[][] {
  const present = new Set(nodes.map((n) => n.sha));
  const lanes: (LaneTenant | null)[] = [];
  return nodes.map((node, row) => {
    const segs = collectIncoming(lanes, node.sha);
    segs.push(...reserveParents(lanes, node, present, stashRows.has(row)));
    return segs;
  });
}

/** Ends every lane awaiting `sha` (as `in`) and passes the others through. */
function collectIncoming(lanes: (LaneTenant | null)[], sha: string): RowSegment[] {
  const segs: RowSegment[] = [];
  for (let i = 0; i < lanes.length; i++) {
    const t = lanes[i];
    if (!t) continue;
    const ends = t.sha === sha;
    segs.push({ kind: ends ? "in" : "pass", lane: i, dashed: t.dashed });
    if (ends) lanes[i] = null;
  }
  return segs;
}

/** Opens an `out` line per displayed parent in the lane the backend
 * reserved for it. A lane already awaiting the same parent is joined; a
 * lane awaiting a different commit is left alone rather than overwritten. */
function reserveParents(
  lanes: (LaneTenant | null)[],
  node: GraphNode,
  present: Set<string>,
  isStash: boolean,
): RowSegment[] {
  const segs: RowSegment[] = [];
  node.parents.forEach((sha, k) => {
    const lane = node.parent_lanes[k] ?? (k === 0 ? node.lane : undefined);
    if (lane == null || !present.has(sha)) return;
    const tenant = lanes[lane];
    if (tenant && tenant.sha !== sha) return;
    if (!tenant) lanes[lane] = { sha, dashed: isStash };
    segs.push({ kind: "out", lane, dashed: isStash });
  });
  return segs;
}
