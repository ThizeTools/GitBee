// The actions the history and blame views run on a commit or a line. They touch
// the stores (center mode, graph scroll, clipboard), so they stay out of the
// pure helpers that the tests cover.
import { showGraph, showFileBlame } from "$lib/stores/center";
import { scrollGraphTo } from "$lib/stores/graphscroll";
import { logAppend } from "$lib/stores/logs";
import type { HistoryActions } from "./historyMenu";

/** Shows the graph with `sha` scrolled into view. */
export function showCommitInGraph(sha: string): void {
  showGraph();
  scrollGraphTo(sha);
}

/** Blame of `path` as it was at `sha`. `path` must be the name the file had then. */
export function blameAtCommit(path: string, sha: string): void {
  showFileBlame(path, sha);
}

/** Blame of `path` at the parent of `sha`. A line's commit is the one that
 * changed it, so its parent shows the code as it was before that change. */
export function blamePreviousRevision(path: string, sha: string): void {
  showFileBlame(path, `${sha}^`);
}

/** Copies a full sha to the clipboard. A failed copy is logged, not thrown. */
export async function copyCommitSha(sha: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(sha);
    logAppend("info", `copied ${sha.slice(0, 7)}`);
  } catch (e) {
    logAppend("error", `copy sha: ${e}`);
  }
}

/** The history row actions, bound to the stores. */
export const storeHistoryActions: HistoryActions = {
  showInGraph: showCommitInGraph,
  blameAt: blameAtCommit,
  copySha: (sha: string) => { void copyCommitSha(sha); },
};
