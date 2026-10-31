import type { StatusEntry } from "$lib/ipc";

/** Which file list a row belongs to. Decides the stage vs unstage direction. */
export type ListKind = "unstaged" | "staged";
/** Git side a status entry is read from: index = staged, worktree = unstaged. */
export type StatusSide = "index" | "worktree";
export type ViewMode = "path" | "tree";
export type SortMode = "asc" | "desc";

/** The file open in the center pane, if any. */
export interface ActiveFile {
  file: string;
  staged: boolean;
}

/** Commit summary length limit; drives the 0/72 counter. */
export const SUMMARY_LIMIT = 72;

/**
 * True when the index column carries a real change. Untracked and ignored
 * entries only ever appear in the unstaged list.
 *
 * @example isStaged({ path: "a.ts", index: "modified", worktree: "unmodified", conflicted: false }) // true
 */
export function isStaged(s: StatusEntry): boolean {
  return s.index !== "unmodified" && s.index !== "untracked" && s.index !== "ignored";
}

/**
 * One-glyph marker for a status entry's index or worktree side. Symbol-first
 * on purpose: `+` new, `−` removed, `●` edited, `→` renamed, `!` conflict.
 * Beats opaque M/A/D/R/U codes that need a legend to read.
 *
 * @example statusChar(entry, "worktree") // "●" when the worktree side is modified
 */
export function statusChar(s: StatusEntry, side: StatusSide): string {
  const v = side === "index" ? s.index : s.worktree;
  switch (v) {
    case "modified": return "●"; case "added": return "+";
    case "deleted": return "−"; case "renamed": return "→";
    case "copied": return "⎘"; case "untracked": return "+";
    case "ignored": return "·"; case "conflicted": return "!";
    default: return " ";
  }
}

/**
 * Human-readable tooltip for the glyph returned by `statusChar`.
 *
 * @example statusTitle(entry, "index") // "Added (new file)" when the index side is added
 */
export function statusTitle(s: StatusEntry, side: StatusSide): string {
  const v = side === "index" ? s.index : s.worktree;
  switch (v) {
    case "modified": return "Modified"; case "added": return "Added (new file)";
    case "deleted": return "Deleted"; case "renamed": return "Renamed";
    case "copied": return "Copied"; case "untracked": return "New file (untracked)";
    case "ignored": return "Ignored"; case "conflicted": return "Conflicted";
    default: return "";
  }
}

/**
 * Extension including the dot, or "" when the name has none. A leading dot
 * (".gitignore") is a name, not an extension.
 *
 * @example fileExtension("src/app.svelte") // ".svelte"
 */
export function fileExtension(p: string): string {
  const i = p.lastIndexOf(".");
  return i > 0 ? p.slice(i) : "";
}

/**
 * Git side a list reads from: the staged list shows the index column.
 *
 * @example sideOf("staged") // "index"
 */
export function sideOf(kind: ListKind): StatusSide {
  return kind === "staged" ? "index" : "worktree";
}

/**
 * Layout-store key holding the collapsed flag for a list section.
 *
 * @example collapseKeyFor("unstaged") // "unstagedCollapsed"
 */
export function collapseKeyFor(kind: ListKind): "unstagedCollapsed" | "stagedCollapsed" {
  return kind === "staged" ? "stagedCollapsed" : "unstagedCollapsed";
}

/**
 * Sorted copy by full path. The input array is left untouched.
 *
 * @example sortByPath(files, "desc") // Z to A
 */
export function sortByPath(arr: StatusEntry[], mode: SortMode): StatusEntry[] {
  const out = arr.slice();
  out.sort((a, b) => mode === "asc"
    ? a.path.localeCompare(b.path)
    : b.path.localeCompare(a.path));
  return out;
}

/**
 * CSS flex value for one list section. A folded section keeps only its header;
 * when the sibling is folded, the open section takes all the remaining space.
 *
 * @example blockFlex(false, true) // "1 1 auto"
 */
export function blockFlex(collapsed: boolean, otherCollapsed: boolean): string {
  if (collapsed) return "0 0 auto";
  return otherCollapsed ? "1 1 auto" : "1 1 50%";
}

/**
 * Batch targets when the row is part of a multi-selection of two or more;
 * null when the row should act alone.
 *
 * @example multiSelectionFor(new Set(["a", "b"]), "a") // ["a", "b"]
 */
export function multiSelectionFor(selection: Set<string>, path: string): string[] | null {
  return selection.has(path) && selection.size > 1 ? Array.from(selection) : null;
}

/**
 * Hover-button label: "Stage File", or "Stage 3 Files" when the row is part
 * of a multi-selection.
 *
 * @example batchLabelFor(new Set(["a", "b"]), "a", "Stage") // "Stage 2 Files"
 */
export function batchLabelFor(selection: Set<string>, path: string, verb: "Stage" | "Unstage"): string {
  const n = selection.has(path) ? selection.size : 1;
  return n > 1 ? `${verb} ${n} Files` : `${verb} File`;
}

/**
 * Shift-click range: adds every path between anchor and path in visible order
 * to the existing selection. Returns null when either end is missing from the
 * visible order (for example a conflicted row).
 *
 * @example shiftRange(["a", "b", "c"], "a", "c", new Set()) // Set {"a", "b", "c"}
 */
export function shiftRange(
  order: string[],
  anchor: string,
  path: string,
  selection: Set<string>,
): Set<string> | null {
  const i = order.indexOf(anchor);
  const j = order.indexOf(path);
  if (i < 0 || j < 0) return null;
  const [a, b] = i <= j ? [i, j] : [j, i];
  const next = new Set(selection);
  for (let k = a; k <= b; k++) next.add(order[k]);
  return next;
}

/**
 * Joins a title and optional body into one commit or stash message.
 *
 * @example composeMessage("fix: null check", "") // "fix: null check"
 */
export function composeMessage(summary: string, description: string): string {
  const s = summary.trim();
  const d = description.trim();
  return d ? `${s}\n\n${d}` : s;
}

/**
 * Fill percentage for the summary progress bar, capped at 100.
 *
 * @example summaryPercent(36) // 50
 */
export function summaryPercent(length: number): number {
  return Math.min(100, Math.round((length / SUMMARY_LIMIT) * 100));
}

/**
 * Counter color: red past the limit, amber in the last 12 characters.
 *
 * @example summaryColor(73) // "var(--del)"
 */
export function summaryColor(length: number): string {
  if (length > SUMMARY_LIMIT) return "var(--del)";
  if (length > SUMMARY_LIMIT - 12) return "var(--modified)";
  return "var(--fg-muted)";
}

/**
 * Splits a full commit message (as `git show` prints it) into the summary
 * line and the body, skipping the blank separator lines. CRLF is normalized
 * so messages written on Windows split the same way.
 *
 * @example amendFields("subject\n\nbody") // { summary: "subject", description: "body" }
 */
export function amendFields(full: string): { summary: string; description: string } {
  const lines = full.replace(/\r\n/g, "\n").split("\n");
  let i = 1;
  while (i < lines.length && lines[i] === "") i++;
  return { summary: lines[0] ?? "", description: lines.slice(i).join("\n") };
}

/**
 * Default stash title: "WIP on <branch>: <subject>", or just the branch when
 * HEAD has no subject to show.
 *
 * @example stashTitleFor("main", "") // "WIP on main"
 */
export function stashTitleFor(branch: string, subject: string): string {
  return subject ? `WIP on ${branch}: ${subject}` : `WIP on ${branch}`;
}
