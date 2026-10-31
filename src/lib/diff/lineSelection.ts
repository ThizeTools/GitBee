// Which +/- lines the user picked in the diff viewer, and how a click changes
// the pick. Pure: the viewer keeps the value and hands it to buildPatch.
// Spec: docs/specs/hunk-staging.md.

import type { Hunk } from "$lib/ipc";
import { isChangeLine, type LineRef, type PatchSelection } from "./patchBuilder";

/** Picked lines of one file, in click order, plus the line a Shift+click extends from. */
export interface LinePick {
  refs: LineRef[];
  anchor: LineRef | null;
}

export const NO_PICK: LinePick = { refs: [], anchor: null };

/** Plain click: the line alone. */
export function pickOnly(ref: LineRef): LinePick {
  return { refs: [ref], anchor: ref };
}

/** Ctrl+click: adds the line, or removes it when it is already picked. */
export function toggleLine(pick: LinePick, ref: LineRef): LinePick {
  const picked = pick.refs.some((r) => sameRef(r, ref));
  const refs = picked
    ? pick.refs.filter((r) => !sameRef(r, ref))
    : [...pick.refs, ref];
  return { refs, anchor: ref };
}

/**
 * Shift+click: the changed lines from the anchor to `ref`, both ends included.
 * Ranges stay inside one hunk, because a patch hunk cannot span two hunks. A
 * click in another hunk, or with no anchor, is a plain pick.
 */
export function extendPick(pick: LinePick, ref: LineRef, hunks: readonly Hunk[]): LinePick {
  const anchor = pick.anchor;
  const hunk = hunks[ref.hunk];
  if (!anchor || !hunk || anchor.hunk !== ref.hunk) return pickOnly(ref);
  const lo = Math.min(anchor.line, ref.line);
  const hi = Math.max(anchor.line, ref.line);
  const refs: LineRef[] = [];
  for (let i = lo; i <= hi; i++) {
    const line = hunk.lines[i];
    if (line && isChangeLine(line)) refs.push({ hunk: ref.hunk, line: i });
  }
  return { refs, anchor };
}

/** The picked line indexes of one hunk, for rendering. */
export function pickedInHunk(pick: LinePick, hunkIndex: number): Set<number> {
  return new Set(pick.refs.filter((r) => r.hunk === hunkIndex).map((r) => r.line));
}

/** The pick as a patch selection, for buildPatch. */
export function linesSelection(pick: LinePick): PatchSelection {
  return { kind: "lines", lines: pick.refs };
}

function sameRef(a: LineRef, b: LineRef): boolean {
  return a.hunk === b.hunk && a.line === b.line;
}
