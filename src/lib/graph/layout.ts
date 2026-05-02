import type { GraphNode } from "$lib/ipc";

// Tightened to match the dense, GitKraken-like reference. Each constant is
// load-bearing — the HTML rows in GraphCanvas.svelte must use ROW_HEIGHT
// directly so canvas dots and text rows stay perfectly aligned.
export const ROW_HEIGHT = 24;
// Lane spacing wide enough that adjacent lane lines read as separate
// columns rather than a stacked bundle. Below ~16px the dots and lines
// of neighboring branches visually fuse together.
export const LANE_WIDTH = 18;
export const DOT_RADIUS = 5.5;
export const LEFT_PADDING = 14;
export const TOP_PADDING = 4;

export interface LayoutMetrics {
  totalHeight: number;
  maxLaneX: number;
  rows: number;
}

export function measure(nodes: GraphNode[]): LayoutMetrics {
  let maxLane = 0;
  for (const n of nodes) {
    if (n.lane > maxLane) maxLane = n.lane;
    for (const pl of n.parent_lanes) if (pl > maxLane) maxLane = pl;
  }
  return {
    totalHeight: nodes.length * ROW_HEIGHT + TOP_PADDING * 2,
    maxLaneX: LEFT_PADDING + (maxLane + 1) * LANE_WIDTH,
    rows: nodes.length,
  };
}

export function laneX(lane: number): number {
  return LEFT_PADDING + lane * LANE_WIDTH;
}

export function rowY(row: number): number {
  return TOP_PADDING + row * ROW_HEIGHT + ROW_HEIGHT / 2;
}

export function rowFromY(y: number): number {
  return Math.floor((y - TOP_PADDING) / ROW_HEIGHT);
}
