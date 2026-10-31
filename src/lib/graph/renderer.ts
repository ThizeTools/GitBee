import type { GraphNode } from "$lib/ipc";
import type { RowSegment } from "./edges";
import {
  AVATAR_SIZE, CORNER_RADIUS, DOT_RADIUS, ROW_HEIGHT, TOP_PADDING,
  laneX, rowY,
} from "./layout";

// Lane palette (10 entries, by lane index): saturated so lanes read apart
// at a glance, ~40-50% lightness so white text on lane-colored ref pills
// stays legible. Avoids yellow/amber, reserved for the app accent.
const LANE_COLORS = [
  "#1389A6", // cyan-blue — lane 0 (HEAD chain)
  "#2F6FED", // blue
  "#8B3FD9", // purple
  "#C2389E", // magenta
  "#E0356B", // pink
  "#D93B2B", // red
  "#D2601C", // orange
  "#5E9E24", // lime
  "#2E9E5B", // green
  "#17917F", // teal
];

const LINE_WIDTH = 2;
// Paint alpha for rows outside a hovered ref's history (graph-columns-and-markers spec).
const DIM_ALPHA = 0.25;
const SELECT_RING = "#ffffff";
const SELECT_GLOW = "rgba(255, 255, 255, 0.35)";
// Stash + WIP glyphs match the avatar node size since they share its
// row-anchor role.
const BIG_RADIUS = AVATAR_SIZE / 2;

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
  /** Per-row line segments from `buildRowSegments`, indexed like `nodes`. */
  segments: RowSegment[][];
  scrollTop: number;
  viewHeight: number;
  width: number;
  selectedSha: string | null;
  hoverRow: number | null;
  dpr: number;
  wipPresent?: boolean;
  wipHeadSha?: string | null;
  // Rows whose refs cell holds a badge — get a horizontal connector from
  // the node extending left toward the badge in the lane color.
  rowsWithRefs?: Set<number>;
  /** Rows whose visible node is an HTML avatar overlay. The renderer skips
   *  drawing a canvas dot for these so the avatar sits cleanly on the lane. */
  avatarRows?: Set<number>;
  /** Rows that are stash commits — drawn as a dashed square glyph. */
  stashRows?: Set<number>;
  /** Pixels of canvas overflow rendered to the LEFT of the graph column.
   *  All x-coordinates are translated by this amount so the nodes stay
   *  anchored to the column while connectors extend into the refs cell. */
  extendLeft?: number;
  /** Per-row, the canvas-space x of the right edge of that row's badge.
   *  Connectors end here; rows missing from the map run to the canvas
   *  left edge. */
  badgeEndsByRow?: Map<number, number>;
  /** Shas of the commits in a hovered ref's history. Rows outside it paint at
   *  DIM_ALPHA. Null or absent means no highlight. */
  highlightSet?: ReadonlySet<string> | null;
}

/** Paints the visible slice of the graph: line segments, then nodes on top.
 * Example: `render({ ctx, nodes, shaToRow, segments, scrollTop, ... })` */
export function render(args: RenderArgs): void {
  const { ctx, nodes, scrollTop, viewHeight, width, dpr } = args;
  const extendLeft = args.extendLeft ?? 0;
  const bg = readBgColor();
  ctx.save();
  ctx.scale(dpr, dpr);
  // Shift the entire drawing rightward by extendLeft so nodes line up with
  // the graph column even though the canvas itself bleeds into the gutter.
  ctx.translate(extendLeft, 0);
  ctx.clearRect(-extendLeft, 0, width, viewHeight);
  drawWip(ctx, args, bg);
  const startRow = Math.max(0, Math.floor((scrollTop - TOP_PADDING) / ROW_HEIGHT) - 1);
  const endRow = Math.min(nodes.length, Math.ceil((scrollTop + viewHeight - TOP_PADDING) / ROW_HEIGHT) + 1);
  for (let r = startRow; r < endRow; r++) {
    ctx.globalAlpha = rowAlpha(args, r);
    drawRowSegments(ctx, args.segments[r] ?? [], nodes[r].lane, rowY(r) - scrollTop);
  }
  ctx.globalAlpha = 1;
  drawHover(ctx, args);
  for (let r = startRow; r < endRow; r++) {
    ctx.globalAlpha = rowAlpha(args, r);
    drawNode(ctx, args, r, bg);
  }
  ctx.restore();
}

// 1 inside the highlight (or with no highlight), DIM_ALPHA outside it.
function rowAlpha(args: RenderArgs, r: number): number {
  const set = args.highlightSet;
  if (!set) return 1;
  return set.has(args.nodes[r].sha) ? 1 : DIM_ALPHA;
}

// WIP ghost: dashed ring one row above the top, joined to HEAD's node by a
// dashed line in HEAD's lane. Filled with the bg so the line stops at the ring.
function drawWip(ctx: CanvasRenderingContext2D, args: RenderArgs, bg: string): void {
  const { nodes, shaToRow, scrollTop, wipPresent, wipHeadSha } = args;
  if (!wipPresent || !wipHeadSha) return;
  const headRow = shaToRow.get(wipHeadSha);
  if (headRow == null) return;
  const lane = nodes[headRow]?.lane ?? 0;
  const x = laneX(lane);
  const wipY = TOP_PADDING + ROW_HEIGHT / 2 - scrollTop - ROW_HEIGHT;
  ctx.save();
  ctx.globalAlpha = rowAlpha(args, headRow);
  ctx.strokeStyle = laneColor(lane);
  ctx.lineWidth = LINE_WIDTH;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(x, wipY);
  ctx.lineTo(x, rowY(headRow) - scrollTop);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.setLineDash([3, 2]);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(x, wipY, BIG_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawRowSegments(ctx: CanvasRenderingContext2D, segs: RowSegment[], nodeLane: number, cy: number): void {
  const top = cy - ROW_HEIGHT / 2;
  const bottom = cy + ROW_HEIGHT / 2;
  const nx = laneX(nodeLane);
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of segs) {
    ctx.strokeStyle = laneColor(s.lane);
    ctx.setLineDash(s.dashed ? [4, 4] : []);
    ctx.beginPath();
    tracePath(ctx, s.kind, laneX(s.lane), nx, top, cy, bottom);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/** Orthogonal edge with one rounded corner: verticals stay in the lane, the
 * horizontal run sits on the node's center line. `arcTo` degrades to a
 * straight line when the lane is the node's own (radius 0). */
function tracePath(
  ctx: CanvasRenderingContext2D, kind: RowSegment["kind"],
  lx: number, nx: number, top: number, cy: number, bottom: number,
): void {
  const r = Math.min(CORNER_RADIUS, Math.abs(lx - nx));
  if (kind === "pass") {
    ctx.moveTo(lx, top);
    ctx.lineTo(lx, bottom);
  } else if (kind === "in") {
    ctx.moveTo(lx, top);
    ctx.arcTo(lx, cy, nx, cy, r);
    ctx.lineTo(nx, cy);
  } else {
    ctx.moveTo(nx, cy);
    ctx.arcTo(lx, cy, lx, bottom, r);
    ctx.lineTo(lx, bottom);
  }
}

function nodeRadius(args: RenderArgs, r: number): number {
  if (args.avatarRows?.has(r)) return AVATAR_SIZE / 2 + 2;
  if (args.stashRows?.has(r)) return BIG_RADIUS;
  return DOT_RADIUS;
}

function drawHover(ctx: CanvasRenderingContext2D, args: RenderArgs): void {
  const { hoverRow, nodes, scrollTop } = args;
  if (hoverRow == null || hoverRow < 0 || hoverRow >= nodes.length) return;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.arc(laneX(nodes[hoverRow].lane), rowY(hoverRow) - scrollTop, nodeRadius(args, hoverRow) + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawNode(ctx: CanvasRenderingContext2D, args: RenderArgs, r: number, bg: string): void {
  const node = args.nodes[r];
  const x = laneX(node.lane);
  const y = rowY(r) - args.scrollTop;
  const color = laneColor(node.lane);
  if (args.rowsWithRefs?.has(r)) drawRefConnector(ctx, args, r, x, y, color);
  // Rows with an HTML avatar overlay skip the canvas node: the avatar IS
  // the node. Merges and author-less commits get a solid dot.
  if (!args.avatarRows?.has(r)) {
    if (args.stashRows?.has(r)) drawStashGlyph(ctx, x, y, color, bg);
    else drawDot(ctx, x, y, color, bg);
  }
  if (node.sha === args.selectedSha) drawSelection(ctx, x, y, nodeRadius(args, r));
}

// Lane-colored connector from the node leftward to its ref pill, ending at
// the pill's measured right edge. The checked-out branch gets a solid 2px
// line; others a thinner translucent one so pills read as attached without
// the connectors dominating the view.
function drawRefConnector(
  ctx: CanvasRenderingContext2D, args: RenderArgs, r: number, x: number, y: number, color: string,
): void {
  const isHead = args.wipHeadSha != null && args.nodes[r].sha === args.wipHeadSha;
  const extendLeft = args.extendLeft ?? 0;
  const badgeEnd = args.badgeEndsByRow?.get(r);
  ctx.save();
  ctx.strokeStyle = color;
  // Multiply: the caller already set the row's dim alpha.
  ctx.globalAlpha *= isHead ? 1 : 0.5;
  ctx.lineWidth = isHead ? 2 : 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  // badgeEnd is canvas-space; subtract extendLeft for post-translate space.
  ctx.lineTo(badgeEnd != null ? badgeEnd - extendLeft : -extendLeft, y);
  ctx.stroke();
  ctx.restore();
}

// Stash: rounded SQUARE with dashed border + two-bar glyph inside. Square
// (not circle) so it's visually distinct from a commit node — only the WIP
// ghost stays circular.
function drawStashGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, bg: string): void {
  const half = BIG_RADIUS;
  ctx.fillStyle = bg;
  ctx.fillRect(x - half - 1, y - half - 1, (half + 1) * 2, (half + 1) * 2);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([3, 2]);
  roundedRect(ctx, x - half, y - half, half * 2, half * 2, 2);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = color;
  ctx.fillRect(x - 3, y - 2, 6, 1.5);
  ctx.fillRect(x - 3, y + 1, 6, 1.5);
}

// Solid dot with a bg "punch" ring so lines visibly stop at the node.
function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, bg: string): void {
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(x, y, DOT_RADIUS + 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

// Crisp white ring just outside the node plus a soft glow so selection
// pops over any lane color.
function drawSelection(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.save();
  ctx.strokeStyle = SELECT_GLOW;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, radius + 3.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = SELECT_RING;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
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
