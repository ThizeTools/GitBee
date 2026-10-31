// The name a file had before a commit renamed it. A per-file commit diff asks
// for both names (diff_commit's `oldFile`), or git shows the rename as an add.
// Pure: each caller passes the list it already has, so no git call happens here.
import type { CommitFileStat, FileLogEntry } from "$lib/ipc";

/**
 * The old name of `path` in a commit's file list, or undefined when the commit
 * did not rename it. `stats` comes from commit_files, which runs rename
 * detection, so `old_path` is set exactly for renames.
 * Example: renamedFromStats(files, "src/new.ts") → "src/old.ts"
 */
export function renamedFromStats(stats: readonly CommitFileStat[], path: string): string | undefined {
  const stat = stats.find((s) => s.path === path);
  return stat?.old_path ?? undefined;
}

/**
 * The name before the rename made by the commit at `index`, in a file history
 * (newest first). It is the name in the next older entry, which is the same
 * file's commit just before this one. Undefined when the commit is not a rename,
 * or the older entry is not in the loaded page.
 * Example: renamedFromLog(entries, 0) with entries[0].status "R" → entries[1].path_at_commit
 */
export function renamedFromLog(entries: readonly FileLogEntry[], index: number): string | undefined {
  const entry = entries[index];
  if (entry?.status !== "R") return undefined;
  return entries[index + 1]?.path_at_commit;
}
