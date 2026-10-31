# Graph visual (2026-10)

Supersedes the paint rules of [graph-visual-2026-04.md](graph-visual-2026-04.md).
Neighbors: [repo-refresh.md](repo-refresh.md) (checkout gestures on the graph).

## Purpose
Make the commit graph read like GitKraken's: every lane is a clean
vertical line, branches leave and join on the commit's center line with
one rounded corner, nodes are author avatars ringed in the lane color,
and a merge into a branch that kept going joins that branch's line
instead of drawing a second parallel line to the same commit.

Studied from GitKraken 12.6 (architecture only, no code reused): per-row
self-contained edge pieces, orthogonal routing with ~8 px arcs, 28 px
rows with 22 px nodes, 10-color palette by lane index, lane reuse for
already-awaited parents.

## What was wrong (v0.4.0)
- An edge was drawn child→parent as ONE path spanning many rows. Its
  vertical run used the parent's final lane, not the lane reserved for it,
  so long edges cut through other branches' columns.
- To keep long edges visible the renderer looped from row 0 to the last
  visible row on every frame (O(rows above viewport)).
- A merge whose side parent was already awaited by another lane opened a
  new lane: two parallel lines ran to the same commit.
- Quadratic curves of varying radius (55% of the row) looked soft and
  inconsistent next to straight lanes.

## Public contract

### `buildRowSegments(nodes, stashRows)` — `src/lib/graph/edges.ts`
- Input: displayed nodes (after solo/stash filtering), set of stash row
  indices.
- Output: `RowSegment[][]`, one list per row. `RowSegment` is
  `{ kind: "pass" | "in" | "out", lane, dashed }`:
  - `pass`: the lane's line crosses the row top→bottom;
  - `in`: the lane's line comes from the top and ends at this row's node;
  - `out`: a line leaves this row's node into the lane and goes down.
- Replays the backend's reservations: `parent_lanes[k]` carries
  `parents[k]`. A parent not among `nodes` (beyond the load limit or
  filtered out) starts no line. A lane already awaiting the same parent
  gets an `out` that joins it; a lane awaiting a different commit is left
  alone (no line drawn rather than an overwritten one).
- Lines leaving a stash row are dashed down to their parent.

### `render(args)` — `src/lib/graph/renderer.ts`
New required input `segments` (from `buildRowSegments`). Draws only
visible rows (±1). Per segment, with node x `nx`, lane x `lx`, row
center `cy`:
- pass: `(lx, top) → (lx, bottom)`;
- in: `(lx, top)` down, corner of radius `min(8, |lx-nx|)`, along `cy` to `nx`;
- out: from `nx` along `cy`, corner, down to `(lx, bottom)`.
Color = lane color of the segment's lane.

### Backend lane assignment — `src-tauri/src/git/graph.rs`
A merge's side parent that some lane already awaits reuses that lane
(`parent_lanes[k]` = that lane). Otherwise unchanged: the first-parent chain
of the pinned ref, else HEAD, takes lane 0 (see [lane-pin.md](lane-pin.md));
the first parent keeps the child's lane; compaction by first use.

## Visual constants (`src/lib/graph/layout.ts`)
| constant | value | was |
|---|---|---|
| `ROW_HEIGHT` | 28 | 24 |
| `LANE_WIDTH` | 22 | 18 |
| `LEFT_PADDING` | 16 | 14 |
| `AVATAR_SIZE` | 18 (+2 px lane ring = 22) | 14 |
| `DOT_RADIUS` (merge / no-avatar) | 6 | 5.5 |
| `CORNER_RADIUS` | 8 | — |
| line width | 2 | 2.4 |

- Palette: 10 saturated colors, `lane % 10`, ~40-50% lightness so white
  pill text stays legible; no yellow (app accent).
- Ref connector: checked-out branch 2 px solid; others 1.5 px at 50%
  alpha.
- Selection: white ring at node radius + 2, soft glow outside it.
- WIP: dashed ring (avatar size) filled with the background, dashed line
  down to HEAD's node.
- Ref pills grow to an 18 px line height to fit the 28 px row.

## Invariants
- Node center is exactly `(laneX(lane), rowY(row))`; HTML rows use
  `ROW_HEIGHT` so canvas and text stay locked.
- Each row's drawing depends only on that row's segments and node.
- Every vertical line runs in the lane that is reserved for it; lines
  only move horizontally on a node's center line.
- Same lane → same color across the view.

## Out of scope
- Moving lane layout to the frontend or changing `--date-order`.
- Leftward compaction of a first parent awaited by several lanes
  (siblings still run parallel down to their common base).
- Per-branch color overrides; light-theme-specific palette.
- Lines running off the bottom for parents beyond the load limit.

## Rejected alternatives
- **Per-row SVG (GitKraken's approach).** One canvas already virtualizes
  well here; switching tech would rewrite GraphCanvas for no visual gain.
  We take the geometry, not the medium.
- **Backend emits segments.** ~5 segments × 10k rows bloats every
  refresh's JSON and would ignore frontend filtering (solo, hidden
  stashes). Segments are derivable from `lane` + `parent_lanes`.
- **Keep spanning edges, just fix the lane used.** Still needs the row-0
  scan and cannot express a line passing through rows cleanly.
- **Bezier S-curves between lanes.** Corners of fixed radius on the node
  line read as "this branch left/joined here"; S-curves between rows
  blur which row the fork belongs to.
