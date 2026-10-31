import { writable } from "svelte/store";

// Center is graph, working-dir file, commit-file (file at a past commit), or
// conflict (the block-by-block resolver for a conflicted worktree file).
// Commit/stash details still live in the right panel; commit-file is the
// child view that opens when the user clicks a file in those details.
export type CenterMode =
  | { kind: "graph" }
  | { kind: "file"; file: string; staged: boolean }
  | { kind: "commit-file"; sha: string; file: string }
  | { kind: "conflict"; file: string };

export const centerMode = writable<CenterMode>({ kind: "graph" });

export function showGraph() { centerMode.set({ kind: "graph" }); }
export function showFile(file: string, staged: boolean) {
  centerMode.set({ kind: "file", file, staged });
}
export function showCommitFile(sha: string, file: string) {
  centerMode.set({ kind: "commit-file", sha, file });
}
/** Opens the conflict editor for one conflicted file. See docs/specs/conflict-resolution.md. */
export function showConflict(file: string) {
  centerMode.set({ kind: "conflict", file });
}
