// Pure undo/redo bookkeeping. No Svelte or Tauri imports, so bun test can
// run it. The reactive store and the toast/busy wrapper live in history.ts.

/** One reversible user action. `undo` returns the repo to the state before
 * the action. `redo`, when present, applies the action again; an entry
 * without `redo` can be undone but never redone. */
export interface UndoEntry {
  label: string;
  undo: () => Promise<void>;
  redo?: () => Promise<void>;
}

/** Oldest entries are dropped past this count, so memory stays bounded. */
export const HISTORY_LIMIT = 50;

/** Runs one step (an entry's undo or redo) and reports whether it worked. */
export type StepRunner = (
  kind: "Undo" | "Redo",
  entry: UndoEntry,
  step: () => Promise<void>,
) => Promise<boolean>;

/** Two LIFO stacks. A new action always clears the redo stack, because the
 * redo branch no longer follows from the current state. */
export class HistoryStacks {
  private undoItems: UndoEntry[] = [];
  private redoItems: UndoEntry[] = [];

  record(entry: UndoEntry): void {
    this.undoItems.push(entry);
    if (this.undoItems.length > HISTORY_LIMIT) this.undoItems.shift();
    this.redoItems = [];
  }

  undoEntries(): UndoEntry[] {
    return [...this.undoItems];
  }

  redoEntries(): UndoEntry[] {
    return [...this.redoItems];
  }

  takeUndo(): UndoEntry | undefined {
    return this.undoItems.pop();
  }

  takeRedo(): UndoEntry | undefined {
    return this.redoItems.pop();
  }

  /** Files an entry whose redo just succeeded. Does not clear the redo stack. */
  fileUndo(entry: UndoEntry): void {
    this.undoItems.push(entry);
  }

  /** Files an entry whose undo just succeeded. Does not clear the redo stack. */
  fileRedo(entry: UndoEntry): void {
    this.redoItems.push(entry);
  }
}

/** Undoes the newest entry. A failed undo is dropped: it is neither
 * redoable nor pushed back, because the repo may be half-changed.
 * Returns false when there was nothing to undo or the step failed.
 * Example: `await undoNewest(stacks, run)` */
export async function undoNewest(stacks: HistoryStacks, run: StepRunner): Promise<boolean> {
  const entry = stacks.takeUndo();
  if (!entry) return false;
  const ok = await run("Undo", entry, entry.undo);
  if (ok && entry.redo) stacks.fileRedo(entry);
  return ok;
}

/** Redoes the newest redo entry. A failed redo is dropped, the same as a
 * failed undo. Returns false when there was nothing to redo or it failed. */
export async function redoNewest(stacks: HistoryStacks, run: StepRunner): Promise<boolean> {
  const entry = stacks.takeRedo();
  if (!entry?.redo) return false;
  const ok = await run("Redo", entry, entry.redo);
  if (ok) stacks.fileUndo(entry);
  return ok;
}
