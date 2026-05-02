import { writable, get } from "svelte/store";

// Session-scoped undo/redo stack. We track commit operations: when the
// user runs an "undo last commit" we push onto redo so they can recommit;
// when they make a normal commit we clear redo.
export interface UndoEntry { kind: "commit"; sha: string; message: string; }

export const undoStack = writable<UndoEntry[]>([]);
export const redoStack = writable<UndoEntry[]>([]);

export function pushUndo(e: UndoEntry) {
  undoStack.update((s) => [...s, e]);
  redoStack.set([]);
}
export function moveToRedo(): UndoEntry | null {
  const u = get(undoStack);
  if (u.length === 0) return null;
  const top = u[u.length - 1];
  undoStack.set(u.slice(0, -1));
  redoStack.update((s) => [...s, top]);
  return top;
}
export function moveFromRedo(): UndoEntry | null {
  const r = get(redoStack);
  if (r.length === 0) return null;
  const top = r[r.length - 1];
  redoStack.set(r.slice(0, -1));
  undoStack.update((s) => [...s, top]);
  return top;
}
