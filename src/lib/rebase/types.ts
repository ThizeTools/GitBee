// Shapes shared by the rebase editor, its pure rules and the ipc call.
// Entries are kept newest first, like the graph. The backend takes the list
// oldest first, so `toItems` (model.ts) reverses it. Spec: docs/specs/interactive-rebase.md.

export type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export const REBASE_ACTIONS: readonly RebaseAction[] = ["pick", "reword", "squash", "fixup", "drop"];

/** One commit of the editor. */
export interface RebaseEntry {
  sha: string;
  subject: string;
  author: string;
  action: RebaseAction;
  /** Full message as git stores it. Null until loaded (only for rows that show a message box). */
  fullMessage: string | null;
  /** Text the user typed in the message box. Null while untouched. */
  draft: string | null;
  /** Why the full message could not be loaded. Null when it loaded or was never needed. */
  loadError: string | null;
}

/** One row of the list the backend replays, oldest first. */
export interface RebaseItem {
  action: RebaseAction;
  sha: string;
  /** Null unless the message is new or edited (see messageToSend). */
  message: string | null;
}

/** What `rebase_interactive` returns. `after` is null when the rebase stopped. */
export interface RebaseOutcome {
  status: "done" | "stopped";
  message: string;
  before: string;
  after: string | null;
}
