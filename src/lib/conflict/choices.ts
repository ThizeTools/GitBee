import { hasMarkers, resolveConflicts } from "./parse";
import type { ConflictChoice, ConflictDoc, ConflictSegment } from "./parse";

// Progress and navigation for the conflict editor, kept out of the component so
// the rules (what counts as resolved, when Save is allowed) are testable.

export interface IndexedSegment {
  segment: ConflictSegment;
  /** Index of the block in file order, or -1 for plain text. */
  blockIndex: number;
}

/**
 * Pairs every segment with its block index, so the view labels blocks and keys
 * choices without counting by hand.
 *
 * @example indexSegments(doc).map((r) => r.blockIndex) // [-1, 0, -1, 1]
 */
export function indexSegments(doc: ConflictDoc): IndexedSegment[] {
  let next = 0;
  return doc.segments.map((segment) => {
    if (segment.kind === "text") return { segment, blockIndex: -1 };
    const blockIndex = next;
    next++;
    return { segment, blockIndex };
  });
}

/** Number of blocks that have a choice. Keys are block indexes in file order. */
export function resolvedCount(
  doc: ConflictDoc,
  choices: Record<number, ConflictChoice>,
): number {
  let n = 0;
  for (let i = 0; i < doc.conflicts.length; i++) {
    if (choices[i] !== undefined) n++;
  }
  return n;
}

/** True when every block has a choice. Empty files (no blocks) count as resolved. */
export function allResolved(
  doc: ConflictDoc,
  choices: Record<number, ConflictChoice>,
): boolean {
  return resolvedCount(doc, choices) === doc.conflicts.length;
}

/**
 * Save is allowed only when every block is decided and the rebuilt text has no
 * markers left. This is the invariant that keeps a half-resolved file from
 * being written and staged.
 *
 * @example canSave(doc, {0: "ours"}, "a\nx\n") // true for a one-block file
 */
export function canSave(
  doc: ConflictDoc,
  choices: Record<number, ConflictChoice>,
): boolean {
  if (!allResolved(doc, choices)) return false;
  return !hasMarkers(resolveConflicts(doc, choices));
}

/**
 * Index of the block Previous or Next moves to. Clamps at the ends instead of
 * wrapping, so the counter never jumps from last to first.
 *
 * @example stepConflict(0, 3, -1) // 0
 */
export function stepConflict(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return 0;
  return Math.min(count - 1, Math.max(0, current + step));
}

/**
 * The next file still in conflict after `current`, for the "return to the next
 * conflicted file" step after a save. Null when no other file is conflicted.
 *
 * @example pickNextConflictedPath([{ path: "a", conflicted: true }], "a") // null
 */
export function pickNextConflictedPath(
  entries: ReadonlyArray<{ path: string; conflicted: boolean }>,
  current: string,
): string | null {
  const next = entries.find((e) => e.conflicted && e.path !== current);
  return next ? next.path : null;
}
