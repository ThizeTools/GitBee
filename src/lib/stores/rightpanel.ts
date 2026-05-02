import { writable } from "svelte/store";

// What the right panel shows. "changes" is the WIP staging area; commits
// and stashes preempt it when the user clicks one in the graph or sidebar.
export type RightSelection =
  | { kind: "none" }
  | { kind: "changes" }
  | { kind: "commit"; sha: string }
  | { kind: "stash"; index: number };

export const rightSelection = writable<RightSelection>({ kind: "changes" });

export function showChanges() { rightSelection.set({ kind: "changes" }); }
export function showCommit(sha: string) { rightSelection.set({ kind: "commit", sha }); }
export function showStash(index: number) { rightSelection.set({ kind: "stash", index }); }
export function clearSelection() { rightSelection.set({ kind: "none" }); }
