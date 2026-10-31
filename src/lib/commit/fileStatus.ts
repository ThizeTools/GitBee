// Labels for one row of a commit's file list: the status letter git reports
// and the change count next to it.
import type { CommitFileStat } from "$lib/ipc";

const STATUS_NAMES: Record<string, string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
};

const STATUS_COLORS: Record<string, string> = {
  A: "var(--add)",
  M: "var(--modified)",
  D: "var(--del)",
  R: "var(--accent)",
  C: "var(--accent)",
  T: "var(--tag)",
};

/** Human name for a status letter. Unknown letters read as "Changed". */
export function statusName(status: string): string {
  return STATUS_NAMES[status] ?? "Changed";
}

/** Theme color for a status letter, as a CSS value. */
export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "var(--fg-muted)";
}

/**
 * Changed lines (additions + deletions) shown beside a file, or "bin" for a
 * binary file. Usage: changeCountLabel({ additions: 2, deletions: 1, … }) is "3".
 */
export function changeCountLabel(f: CommitFileStat): string {
  if (f.additions === null || f.deletions === null) return "bin";
  return String(f.additions + f.deletions);
}
