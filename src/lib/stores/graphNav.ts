import { writable } from "svelte/store";
import type { FileDiff } from "$lib/ipc";

// Keyboard navigation state for the graph + commit details flow.
// - "graph"  → ArrowUp/Down move the selected commit, ArrowRight enters
//              the file list for that commit.
// - "files"  → ArrowUp/Down move the highlighted file, Enter opens it,
//              ArrowLeft returns to the graph.
//
// CommitDetailsPanel publishes its current file list here so the global
// key handler in +page.svelte can act without reaching into the panel.
export type FocusMode = "graph" | "files";

export const focusMode = writable<FocusMode>("graph");
export const selectedFileIndex = writable<number>(0);
export const commitFiles = writable<FileDiff[]>([]);

export function setFocus(m: FocusMode): void {
  focusMode.set(m);
  if (m === "graph") selectedFileIndex.set(0);
}
