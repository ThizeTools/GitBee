// Which files' diffs a commit details panel requests. Pure, so the cap is
// tested without the panel.
import type { CommitFileStat } from "$lib/ipc";

/**
 * "Show diffs" requests at most this many diffs, the first in list order. WHY:
 * each diff can run to 5000 lines and each costs a git process. Beyond the cap
 * the user asks for the rest with "Load all".
 */
export const EXPAND_ALL_CAP = 30;

/** Paths "Show diffs" requests: the first `cap` files in the order shown. */
export function expandAllPaths(order: CommitFileStat[], cap: number = EXPAND_ALL_CAP): string[] {
  return order.slice(0, cap).map((f) => f.path);
}

/** Paths of files whose diffs are not requested yet, in the order shown. */
export function notRequested(order: CommitFileStat[], requested: Record<string, true>): string[] {
  return order.map((f) => f.path).filter((p) => !requested[p]);
}
