import type { GraphNode } from "$lib/ipc";
import {
  DOT_RADIUS, ROW_HEIGHT, TOP_PADDING,
  laneX, rowY,
} from "./layout";

// Lane palette: avoids yellow/amber (reserved for the app accent) and the
// near-white/black of the bg so dots and lines never compete with the
// brand color. ~45-50% lightness so white text on the lane-colored
// badges hits AA contrast.
const LANE_COLORS = [
  "#0E8C82", // teal — default first branch (HEAD lane)
  "#A23A78", // magenta
  "#3F8C3D", // green
  "#2E6BB8", // blue
  "#B86A1F", // orange
  "#6E4DB0", // purple
  "#B33B3B", // red
  "#3FA3A0", // cyan
];

const LINE_WIDTH = 2.4;
const SELECT_RING = "#ffffff";
const SELECT_GLOW = "rgba(255, 255, 255, 0.35)";

// Pull the current --bg theme value at draw time so the "punch" circle
// behind each dot sits on the actual background color regardless of
// which theme is active.
function readBgColor(): string {
  if (typeof document === "undefined") return "#0a0a0a";
  return getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0a0a0a";
}

export interface RenderArgs {
  ctx: CanvasRenderingContext2D;
  nodes: GraphNode[];
  shaToRow: Map<string, number>;
  scrollTop: number;
  viewHeight: number;
  width: number;
  selectedSha: string | null;
  hoverRow: number | null;
  dpr: number;
  wipPresent?: boolean;
  wipHeadSha?: string | null;
  // Rows whose refs cell holds a badge — get a horizontal stub from dot
  // extending left toward the badge in the lane color.
  rowsWithRefs?: Set<number>;
  /** Rows whose visible "dot" is actually an HTML avatar overlay. The
   *  renderer skips drawing a canvas dot for these so the avatar sits
   *  cleanly on the lane without a colored disc bleeding around it. */
  avatarRows?: Set<number>;
  /** Rows that are stash commits — drawn as a special dashed-edge,
   *  filled-circle glyph instead of the regular dot. */
  stashRows?: Set<number>;
  /** Pixels of canvas overflow rendered to the LEFT of the graph column.
   *  All x-coordinates are translated by this amount so the graph dots
   *  stay visually anchored to the column while stub lines can extend
   *  into the gutter / refs cell. */
  extendLeft?: number;
  /** Per-row, the canvas-space x of the right edge of that row's badge
   *  (or `wip-inline` chip). Stub lines end here instead of running off
   *  to the panel edge. Rows missing from the map fall back to drawing
   *  the stub all the way to the canvas left edge. */
  badgeEndsByRow?: Map<number, number>;
}

export function render(args: RenderArgs): void {
  const {
    ctx, nodes, shaToRow, scrollTop, viewHeight, width,
    selectedSha, hoverRow, dpr, wipPresent, wipHeadSha,
  } = args;
  const BG_COLOR = readBgColor();

  const rowsWithRefs = args.rowsWithRefs;

  const extendLeft = args.extendLeft ?? 0;

  ctx.save();
  ctx.scale(dpr, dpr);
  // Shift the entire drawing rightward by extendLeft so dots line up with
  // the graph column even though the canvas itself bleeds into the gutter.
  ctx.translate(extendLeft, 0);
  ctx.clearRect(-extendLeft, 0, width, viewHeight);

  // Stash + WIP are drawn at the same visual weight as the user
  // avatars (~14px diameter) since they share the row-anchor role.
  // Merge dots stay at DOT_RADIUS so the donut donut/lane connection
  // stays compact.
  const BIG_RADIUS = 7;

  if (wipPresent && wipHeadSha) {
    const headRow = shaToRow.get(wipHeadSha);
    if (headRow != null) {
      const headLane = nodes[headRow]?.lane ?? 0;
      const wipScreenY = TOP_PADDING + ROW_HEIGHT / 2 - scrollTop - ROW_HEIGHT;
      const headScreenY = rowY(headRow) - scrollTop;
      const x = laneX(headLane);
      ctx.save();
      ctx.strokeStyle = LANE_COLORS[headLane % LANE_COLORS.length];
      ctx.lineWidth = LINE_WIDTH;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, wipScreenY);
      ctx.lineTo(x, headScreenY);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = LANE_COLORS[headLane % LANE_COLORS.length];
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.arc(x, wipScreenY, BIG_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  const startRow = Math.max(0, Math.floor((scrollTop - TOP_PADDING) / ROW_HEIGHT) - 1);
  const endRow = Math.min(
    nodes.length,
    Math.ceil((scrollTop + viewHeight - TOP_PADDING) / ROW_HEIGHT) + 1,
  );

  // Edges (parents). We must draw any edge that intersects the visible
  // y-range, even if its child row sits above the viewport — otherwise
  // long-running lanes appear to "vanish" while scrolling. Iterate from
  // row 0 up to endRow, and skip only edges that end strictly above the
  // viewport (parent row < startRow). Nodes are O(N) but the inner work
  // is just a couple of comparisons per row.
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  for (let r = 0; r < endRow; r++) {
    const node = nodes[r];
    const y = rowY(r) - scrollTop;
    const x = laneX(node.lane);

    for (let pi = 0; pi < node.parents.length; pi++) {
      const parentSha = node.parents[pi];
      const parentRow = shaToRow.get(parentSha);
      if (parentRow == null) continue;
      // Edge is entirely above the viewport — skip.
      if (parentRow < startRow) continue;
      // Both endpoints below the viewport — skip (child row > endRow can't
      // happen because of the outer bound, but parent row can).
      if (r > endRow && parentRow > endRow) continue;
      // The lane stored in `parent_lanes[pi]` is the slot the CHILD parked
      // its parent into during layout. When a side branch later converges
      // into main, the parent's real lane ends up on main, not on the
      // child's recorded slot — so trust the parent node's own `lane`
      // field for the edge endpoint. (parent_lanes only matches when no
      // convergence happened.) Without this, fork-off edges draw straight
      // vertical in the side lane and never visually connect to the
      // parent dot sitting on the main lane.
      const parentLane = nodes[parentRow].lane;
      const py = rowY(parentRow) - scrollTop;
      const px = laneX(parentLane);
      ctx.strokeStyle = LANE_COLORS[parentLane % LANE_COLORS.length];
      // Stash edges (either endpoint is a stash row) get a dashed line
      // so they read as "this isn't real history, it's a stash anchor".
      const isStashEdge = args.stashRows?.has(r) || args.stashRows?.has(parentRow);
      ctx.setLineDash(isStashEdge ? [4, 4] : []);
      // Two distinct edge shapes depending on the topology:
      //   merge-in   — child has 2+ parents, this parent sits on a side lane.
      //                Visual: branch drops into the merge dot from below;
      //                bend at the TOP near the merge.
      //   fork-off   — single-parent child whose lane differs from its parent.
      //                Visual: a branch buds off the parent and runs up in a
      //                new lane; bend at the BOTTOM near the parent dot.
      const isMergeEdge = node.parents.length >= 2 && parentLane !== node.lane;
      drawEdge(ctx, x, y, px, py, isMergeEdge);
    }
  }

  // Hover/selected highlights at lane positions
  if (hoverRow != null && hoverRow >= 0 && hoverRow < nodes.length) {
    const n = nodes[hoverRow];
    const y = rowY(hoverRow) - scrollTop;
    const x = laneX(n.lane);
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.arc(x, y, DOT_RADIUS + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Dots
  for (let r = startRow; r < endRow; r++) {
    const node = nodes[r];
    const x = laneX(node.lane);
    const y = rowY(r) - scrollTop;
    const color = LANE_COLORS[node.lane % LANE_COLORS.length];
    const isSelected = node.sha === selectedSha;
    const isHead = wipHeadSha != null && node.sha === wipHeadSha;
    const isMerge = node.parents.length >= 2;

    // Lane-colored stub from dot leftward toward the ref badge. The HEAD
    // row (the checked-out branch) gets a much heavier stub so the active
    // branch jumps out across the whole view; everyone else stays thin.
    if (rowsWithRefs && rowsWithRefs.has(r)) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = isHead ? 3.2 : 0.8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y);
      // End the stub at the badge's right edge if we have a measurement;
      // otherwise extend all the way to the canvas left edge as a fallback.
      // Canvas-space x of the badge right is `badgeEnd`; we're drawing in
      // post-translate space, so subtract `extendLeft` to convert.
      const badgeEnd = args.badgeEndsByRow?.get(r);
      const stubX = badgeEnd != null ? badgeEnd - extendLeft : -extendLeft;
      ctx.lineTo(stubX, y);
      ctx.stroke();
      ctx.restore();
    }

    // Rows with an HTML avatar overlay (regular non-merge commits) skip
    // the canvas dot entirely — the avatar IS the visible dot. Merge
    // rows always get a solid filled circle (no donut anymore).
    const hasAvatar = args.avatarRows?.has(r) ?? false;
    const isStash = args.stashRows?.has(r) ?? false;

    if (!hasAvatar) {
      if (isStash) {
        // Stash: rounded SQUARE with dashed border + stash glyph inside.
        // Square (not circle) so it's visually distinct from a commit
        // dot — only the WIP ghost stays circular.
        const half = BIG_RADIUS;
        // bg punch behind the square
        ctx.fillStyle = BG_COLOR;
        ctx.fillRect(x - half - 1, y - half - 1, (half + 1) * 2, (half + 1) * 2);

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([3, 2]);
        roundedRect(ctx, x - half, y - half, half * 2, half * 2, 2);
        ctx.stroke();
        ctx.restore();

        // Stash glyph centered in the box (small filled square hint —
        // box-with-content visual, doesn't double up the outer square).
        ctx.fillStyle = color;
        ctx.fillRect(x - 2, y - 1, 4, 1);
        ctx.fillRect(x - 2, y + 1, 4, 1);
      } else {
        // Merge: solid filled disc.
        ctx.fillStyle = BG_COLOR;
        ctx.beginPath();
        ctx.arc(x, y, DOT_RADIUS + 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (isSelected) {
      ctx.save();
      // Outer soft glow so selection pops over any lane color.
      ctx.strokeStyle = SELECT_GLOW;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, DOT_RADIUS + 4.5, 0, Math.PI * 2);
      ctx.stroke();
      // Crisp inner ring.
      ctx.strokeStyle = SELECT_RING;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, DOT_RADIUS + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawEdge(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  bendAtTop: boolean,
) {
  ctx.beginPath();
  if (x1 === x2) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return;
  }
  const sign = Math.sign(y2 - y1) || 1;
  const dy = Math.abs(y2 - y1);
  const r = Math.min(dy, ROW_HEIGHT) * 0.55;
  ctx.moveTo(x1, y1);
  if (bendAtTop) {
    // Merge-in: curve out from the child dot horizontally, then run
    // vertical in the parent's lane down to the parent dot.
    ctx.quadraticCurveTo(x2, y1, x2, y1 + sign * r);
    ctx.lineTo(x2, y2);
  } else {
    // Fork-off (mirror of merge-in): vertical in the child's lane, then
    // curve out into the parent dot at the bottom. Same "L with rounded
    // corner" shape as the top, just flipped — the line approaches the
    // parent dot horizontally just like the merge-in edge leaves the
    // child dot horizontally.
    ctx.lineTo(x1, y2 - sign * r);
    ctx.quadraticCurveTo(x1, y2, x2, y2);
  }
  ctx.stroke();
}

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

/** Draw a rectangle path with rounded corners; caller calls stroke()/fill(). */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
