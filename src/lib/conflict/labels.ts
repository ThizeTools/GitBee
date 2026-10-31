// Which git operation owns the conflict, and what its two sides are called.
// WHY: git's "ours" and "theirs" flip meaning during a rebase. There "ours" is
// the branch being rebased onto and "theirs" is the user's own commit being
// replayed, so the UI must not say "Mine" for ours in that case.

export type ConflictOp = "merge" | "rebase" | "cherry-pick" | "revert";

/** The four in-progress flags from op_state (src-tauri/src/commands/merge.rs). */
export interface OpFlags {
  merging: boolean;
  rebasing: boolean;
  cherry_picking: boolean;
  reverting: boolean;
}

export interface SideNames {
  ours: string;
  theirs: string;
}

/**
 * The op that is running, in the same precedence as the OpBanner, so the
 * banner text and the side labels always agree. Null when no op is running.
 *
 * @example activeOp({ merging: false, rebasing: true, cherry_picking: true, reverting: false }) // "rebase"
 */
export function activeOp(flags: OpFlags | null): ConflictOp | null {
  if (flags === null) return null;
  if (flags.merging) return "merge";
  if (flags.rebasing) return "rebase";
  if (flags.cherry_picking) return "cherry-pick";
  if (flags.reverting) return "revert";
  return null;
}

/**
 * Display names for the ours and theirs sides. Rebase gets its own names;
 * every other op (and the no-op fallback) uses Mine and Theirs.
 *
 * @example sideNames("rebase") // { ours: "Base (onto)", theirs: "Your commit" }
 */
export function sideNames(op: ConflictOp | null): SideNames {
  if (op === "rebase") return { ours: "Base (onto)", theirs: "Your commit" };
  return { ours: "Mine", theirs: "Theirs" };
}

/**
 * Button text that takes one side, e.g. "Take mine" or "Take your commit".
 *
 * @example takeLabel("ours", sideNames("merge")) // "Take mine"
 */
export function takeLabel(side: "ours" | "theirs", names: SideNames): string {
  return `Take ${names[side].toLowerCase()}`;
}
