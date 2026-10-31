// Pure key-to-action mapping and row-index math for the graph shortcuts.
// The store side (moving the selection, scrolling, toasts) lives in
// graphKeyActions.ts; keeping this file free of store and IPC imports lets
// bun test exercise it directly.

import type { CommitRef } from "$lib/ipc";

/** Row movements the graph keys request. `up`/`down` are one row. */
export type RowMove = "up" | "down" | "home" | "end" | "pageUp" | "pageDown";

export type GraphKeyAction =
  | { kind: "move"; move: RowMove }
  | { kind: "head" }
  | { kind: "upstream" };

export type UndoKeyAction = "undo" | "redo";

const MOVE_KEYS = new Map<string, RowMove>([
  ["Home", "home"],
  ["End", "end"],
  ["PageUp", "pageUp"],
  ["PageDown", "pageDown"],
]);

/** Maps a keydown to a graph action, or null when the key is not one.
 * `Shift+H` is the only shifted binding: any other shifted key returns null
 * so text selection and browser shortcuts keep their native behaviour.
 * Example: graphKeyAction("H", true) → { kind: "upstream" } */
export function graphKeyAction(key: string, shift: boolean): GraphKeyAction | null {
  if (key === "H" && shift) return { kind: "upstream" };
  if (shift) return null;
  if (key === "h") return { kind: "head" };
  const move = MOVE_KEYS.get(key);
  return move ? { kind: "move", move } : null;
}

/** Maps Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y to undo or redo, else null. The caller
 * has already checked the Ctrl/Meta modifier and that focus is not in a text
 * field. Example: undoKeyAction("z", true) → "redo" */
export function undoKeyAction(key: string, shift: boolean): UndoKeyAction | null {
  const k = key.toLowerCase();
  if (k === "z") return shift ? "redo" : "undo";
  if (k === "y" && !shift) return "redo";
  return null;
}

// Clamp a row index into [0, last]; the row list never reaches the WIP slot.
function clampRow(index: number, last: number): number {
  return Math.max(0, Math.min(last, index));
}

/** Index of the row a movement lands on, or -1 when there are no rows.
 * `current` < 0 means nothing selected (or the WIP row): the cursor sits just
 * above row 0, so Down lands on row 0 and PageDown on row page-1. Up, PageUp,
 * Home and End never land on WIP.
 * Example: nextRowIndex("pageDown", 3, 100, 20) → 23 */
export function nextRowIndex(
  kind: RowMove,
  current: number,
  total: number,
  page: number,
): number {
  if (total <= 0) return -1;
  const last = total - 1;
  const base = current < 0 ? -1 : Math.min(current, last);
  const step = Math.max(1, page);
  switch (kind) {
    case "home": return 0;
    case "end": return last;
    case "up": return clampRow(base - 1, last);
    case "down": return clampRow(base + 1, last);
    case "pageUp": return clampRow(base - step, last);
    case "pageDown": return clampRow(base + step, last);
  }
}

/** Rows in one PageUp/PageDown step: 60% of the viewport height, so the
 * target row keeps some context on screen. Floor of 1 so tiny windows still
 * move. The caller passes window.innerHeight because the graph's own scroll
 * element is not exported; the 60% factor absorbs the chrome above and below.
 * Example: pageRowCount(800, 28) → 17 */
export function pageRowCount(viewportPx: number, rowPx: number): number {
  return Math.max(1, Math.floor((viewportPx * 0.6) / rowPx));
}

// Branch name part of a remote-tracking ref: "origin/feature/x" → "feature/x".
function remoteBranchOf(refName: string): string {
  const slash = refName.indexOf("/");
  return slash < 0 ? "" : refName.slice(slash + 1);
}

/** Commit sha of the upstream of `headBranch`, i.e. the remote-tracking ref
 * `<remote>/<headBranch>`. `origin` wins when several remotes have it. Null
 * when HEAD is detached or no such ref is among the loaded refs.
 * Example: upstreamSha(graph.refs, "main") → "9f2c…" or null */
export function upstreamSha(
  refs: readonly CommitRef[],
  headBranch: string | null,
): string | null {
  if (!headBranch) return null;
  const matches = refs.filter(
    (r) => r.kind === "remotebranch" && remoteBranchOf(r.name) === headBranch,
  );
  const origin = matches.find((r) => r.name.startsWith("origin/"));
  return (origin ?? matches[0])?.target_sha ?? null;
}

/** Structural subset of a DOM event target, so tests can pass plain objects. */
export interface KeyTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

/** True when a key event comes from a text field, where shortcuts must stay
 * out of the way (search box, commit message, native undo).
 * Example: isEditableTarget({ tagName: "INPUT" }) → true */
export function isEditableTarget(target: KeyTargetLike | null): boolean {
  const tag = target?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select"
    || target?.isContentEditable === true;
}
