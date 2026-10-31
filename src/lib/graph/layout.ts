import type { GraphNode } from "$lib/ipc";

// GitKraken-like proportions: 28 px rows hold a 22 px node (18 px avatar +
// 2 px lane ring) with breathing room, and lanes are one node wide so the
// lines of neighboring branches never fuse. Each constant is load-bearing —
// the HTML rows in GraphCanvas.svelte must use ROW_HEIGHT directly so canvas
// lines and text rows stay perfectly aligned. See docs/specs/graph-visual-2026-10.md.
export const ROW_HEIGHT = 28;
export const LANE_WIDTH = 22;
export const AVATAR_SIZE = 18;
export const DOT_RADIUS = 6;
// Radius of the single corner where a lane line turns onto a node's center line.
export const CORNER_RADIUS = 8;
export const LEFT_PADDING = 16;
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
