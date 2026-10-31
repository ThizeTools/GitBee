// What a hunk needs from its diff viewer: the mode, whether the hunk actions are
// on, the picked lines, and the click handlers. Types only. Spec:
// docs/specs/hunk-staging.md.

import type { PatchAction } from "$lib/diff/patchAction";

/** Which hunk actions a diff offers. Commit and stash diffs are `readonly`. */
export type DiffMode = "unstaged" | "staged" | "readonly";

export interface HunkView {
  mode: DiffMode;
  /** False in readonly mode, under ignore-whitespace, and for a truncated diff. */
  actionsOn: boolean;
  /** Indexes of this hunk's picked lines. */
  picked: ReadonlySet<number>;
  onHunkAction: (action: PatchAction) => void;
  /** Gutter click on the line at `line` (an index into the hunk's lines). */
  onLinePick: (line: number, e: MouseEvent) => void;
}
