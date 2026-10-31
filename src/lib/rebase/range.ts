// Which commits an interactive rebase from a base covers, and whether the
// menu may offer it. Pure: the graph nodes and status come in as arguments.
// Spec: docs/specs/interactive-rebase.md.

import type { GraphNode, StatusEntry } from "$lib/ipc";
import { reachableFrom } from "../graph/reach";
import type { RebaseEntry } from "./types";

/** Pure: the loaded commits of base..HEAD, base excluded, in the order given
 * (newest first in the graph). Empty when the base is not loaded: the range
 * is then unknown, and taking everything below HEAD would be wrong. */
export function commitsToRebase(
  nodes: readonly GraphNode[],
  headSha: string,
  baseSha: string,
): GraphNode[] {
  if (!nodes.some((node) => node.sha === baseSha)) return [];
  const fromHead = reachableFrom(headSha, nodes);
  const fromBase = reachableFrom(baseSha, nodes);
  return nodes.filter((node) => fromHead.has(node.sha) && !fromBase.has(node.sha));
}

/** Pure: the menu offers a rebase from a commit that is a strict ancestor of
 * HEAD. HEAD itself has nothing to rebase, and a commit off HEAD's line is not
 * in its range. */
export function canStartRebaseFrom(
  sha: string,
  headSha: string | null,
  nodes: readonly GraphNode[],
): boolean {
  if (headSha === null || sha === headSha) return false;
  return reachableFrom(headSha, nodes).has(sha);
}

/** Pure: true when any commit in the range is a merge. The editor refuses it:
 * replaying merges needs --rebase-merges, which is out of scope. */
export function hasMergeCommit(commits: readonly GraphNode[]): boolean {
  return commits.some((commit) => commit.parents.length > 1);
}

/** Pure: true when the worktree has a change to a tracked file. Untracked
 * and ignored files do not count; git rebase refuses only tracked changes. */
export function hasTrackedChanges(entries: readonly StatusEntry[]): boolean {
  return entries.some((entry) => isTrackedChange(entry.index) || isTrackedChange(entry.worktree));
}

function isTrackedChange(state: StatusEntry["index"]): boolean {
  return state !== "unmodified" && state !== "untracked" && state !== "ignored";
}

/** Pure: the editor rows for the commits, each starting as a pick. */
export function entriesFromCommits(commits: readonly GraphNode[]): RebaseEntry[] {
  return commits.map((commit) => ({
    sha: commit.sha,
    subject: commit.subject,
    author: commit.author_name,
    action: "pick",
    fullMessage: null,
    draft: null,
    loadError: null,
  }));
}
