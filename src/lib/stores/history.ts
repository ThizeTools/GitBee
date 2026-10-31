// Session-scoped undo/redo for repo actions. Entries are recorded only after
// their action succeeded, and each closure captures the repo it acted on,
// so an undo runs against that repo even after the user switched tabs.
// Spec: docs/specs/undo-history.md.

import { writable, derived } from "svelte/store";
import { busy, refreshActive } from "$lib/stores/repo";
import { logAction } from "$lib/stores/logs";
import { notifyError, notifySuccess } from "$lib/stores/notifications";
import {
  HistoryStacks,
  redoNewest,
  undoNewest,
  type StepRunner,
  type UndoEntry,
} from "$lib/stores/historyStack";

export type { UndoEntry } from "$lib/stores/historyStack";

const stacks = new HistoryStacks();
const undoView = writable<UndoEntry[]>([]);
const redoView = writable<UndoEntry[]>([]);
let stepInFlight = false;

/** True when at least one action can be undone. */
export const canUndo = derived(undoView, (u) => u.length > 0);
/** True when at least one undone action can be redone. */
export const canRedo = derived(redoView, (r) => r.length > 0);
/** Label of the action Undo would revert, or null. */
export const nextUndoLabel = derived(undoView, (u) => (u.length > 0 ? u[u.length - 1].label : null));
/** Label of the action Redo would re-apply, or null. */
export const nextRedoLabel = derived(redoView, (r) => (r.length > 0 ? r[r.length - 1].label : null));

function publish(): void {
  undoView.set(stacks.undoEntries());
  redoView.set(stacks.redoEntries());
}

/** Records an action that just succeeded. Clears the redo stack. */
export function pushUndo(entry: UndoEntry): void {
  stacks.record(entry);
  publish();
}

// One undo or redo step, run like runAction: busy flag, a log line, and a
// refresh on success. A failure becomes a toast, not a banner.
const runStep: StepRunner = async (kind, entry, step) => {
  busy.set(true);
  try {
    const r = await logAction(`${kind} ${entry.label}`, step);
    if (!r.ok) {
      notifyError(`${kind} failed`, r.error);
      return false;
    }
    await refreshActive();
    notifySuccess(kind === "Undo" ? "Undone" : "Redone", entry.label);
    return true;
  } finally {
    busy.set(false);
  }
};

/** Undoes the newest action. Ignored while another undo or redo runs. */
export async function undoLast(): Promise<void> {
  if (stepInFlight) return;
  stepInFlight = true;
  try {
    await undoNewest(stacks, runStep);
  } finally {
    stepInFlight = false;
    publish();
  }
}

/** Re-applies the most recently undone action. Ignored while another undo or redo runs. */
export async function redoLast(): Promise<void> {
  if (stepInFlight) return;
  stepInFlight = true;
  try {
    await redoNewest(stacks, runStep);
  } finally {
    stepInFlight = false;
    publish();
  }
}
