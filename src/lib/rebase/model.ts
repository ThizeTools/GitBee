// Pure rules of the rebase editor: the list it sends, its validation, the
// summary, and the row moves. No Svelte or ipc imports, so bun test covers
// all of it. Mirrors src-tauri/src/commands/rebase_todo.rs; keep both in step.
// Spec: docs/specs/interactive-rebase.md.

import { REBASE_ACTIONS, type RebaseAction, type RebaseEntry, type RebaseItem } from "./types";

const SHORT_SHA = 7;
const KEY_ACTIONS: ReadonlyMap<string, RebaseAction> = new Map([
  ["p", "pick"],
  ["r", "reword"],
  ["s", "squash"],
  ["f", "fixup"],
  ["d", "drop"],
]);

export function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA);
}

/** Squash and fixup fold a commit into the older one above it. */
export function isFold(action: RebaseAction): boolean {
  return action === "squash" || action === "fixup";
}

/** The action for a bare key (p, r, s, f, d; case-insensitive), or null. */
export function keyAction(key: string): RebaseAction | null {
  return KEY_ACTIONS.get(key.toLowerCase()) ?? null;
}

/** The action named by a select's value, or null when it is not one. */
export function parseAction(value: string): RebaseAction | null {
  return REBASE_ACTIONS.find((action) => action === value) ?? null;
}

/** Entries oldest first, the order the backend replays. A new array. */
export function oldestFirst(entries: readonly RebaseEntry[]): RebaseEntry[] {
  return [...entries].reverse();
}

/** Pure: the message a row sends, or null for none. Reword always sends its
 * text, the draft or else the full message. A pick sends only an edited
 * message: an untouched squash head keeps git's combined message. */
export function messageToSend(entry: RebaseEntry): string | null {
  if (entry.action === "reword") return entry.draft ?? entry.fullMessage;
  if (entry.action === "pick" && entry.draft !== null) return entry.draft;
  return null;
}

/** The list for `rebase_interactive`, oldest first. */
export function toItems(entries: readonly RebaseEntry[]): RebaseItem[] {
  return oldestFirst(entries).map((entry) => ({
    action: entry.action,
    sha: entry.sha,
    message: messageToSend(entry),
  }));
}

/** Why the list cannot be started, or null when it can. Only the first
 * problem is returned; the editor shows one line. */
export function firstProblem(entries: readonly RebaseEntry[]): string | null {
  const ordered = oldestFirst(entries);
  const oldestKept = ordered.find((entry) => entry.action !== "drop");
  if (!oldestKept) return "Keep at least one commit: every row is dropped.";
  if (isFold(oldestKept.action)) {
    return `The oldest kept commit ${shortSha(oldestKept.sha)} cannot be squash or fixup: nothing older is left to fold it into.`;
  }
  for (const entry of entries) {
    const problem = messageProblem(entry);
    if (problem !== null) return problem;
  }
  return null;
}

function messageProblem(entry: RebaseEntry): string | null {
  const text = messageToSend(entry);
  if (text === null) {
    if (entry.action !== "reword") return null;
    if (entry.loadError !== null) {
      return `Could not load the message of ${shortSha(entry.sha)}: ${entry.loadError}`;
    }
    return `Loading the message of ${shortSha(entry.sha)}…`;
  }
  return text.trim() === "" ? `The message of ${shortSha(entry.sha)} is empty.` : null;
}

/** "N commits → M" where M counts the commits left: not dropped, not folded. */
export function summary(entries: readonly RebaseEntry[]): string {
  const resulting = entries.filter(
    (entry) => entry.action !== "drop" && !isFold(entry.action),
  ).length;
  return `${plural(entries.length)} → ${plural(resulting)}`;
}

function plural(count: number): string {
  return `${count} commit${count === 1 ? "" : "s"}`;
}

/** For each entry (display order), whether its message box is shown: reword
 * rows, and pick rows that squash or fixup rows fold into. Mirrors
 * `amend_after_rows` in the backend. */
export function editableFlags(entries: readonly RebaseEntry[]): boolean[] {
  const ordered = oldestFirst(entries);
  const folds = foldCounts(ordered.map((entry) => entry.action));
  const flags = ordered.map(
    (entry, index) =>
      entry.action === "reword" || (entry.action === "pick" && folds[index] > 0),
  );
  return flags.reverse();
}

/** Oldest-first actions to the number of fold rows each pick or reword
 * head gets. A drop belongs to no group, and does not end the group above it. */
function foldCounts(actions: readonly RebaseAction[]): number[] {
  const counts = actions.map(() => 0);
  let head = -1;
  actions.forEach((action, index) => {
    if (action === "pick" || action === "reword") head = index;
    else if (isFold(action) && head >= 0) counts[head] += 1;
  });
  return counts;
}

/** A new array with the item at `from` moved to `to`. Out of range is a no-op copy. */
export function moveRow<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const inRange = (i: number): boolean => i >= 0 && i < items.length;
  if (from === to || !inRange(from) || !inRange(to)) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** A new array with the entry at `index` patched. An index out of range changes nothing. */
export function updateRow(
  entries: readonly RebaseEntry[],
  index: number,
  patch: Partial<RebaseEntry>,
): RebaseEntry[] {
  return entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
}

/** Index of the entry with this sha, or -1. */
export function indexOfSha(entries: readonly RebaseEntry[], sha: string): number {
  return entries.findIndex((entry) => entry.sha === sha);
}
