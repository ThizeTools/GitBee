// "Go to commit <sha7> <subject>" rows over the loaded graph. The unprefixed
// finder only offers them for sha-looking queries; the "#" mode lists all of
// them and lets fuzzy ranking order the subjects.

import { selectedSha } from "$lib/stores/repo";
import { showCommit } from "$lib/stores/rightpanel";
import { scrollGraphTo } from "$lib/stores/graphscroll";
import { isShaQuery } from "$lib/palette/query";
import type { CommitRow } from "$lib/palette/sources";
import type { PaletteItem } from "$lib/palette/types";

/** Selects the commit in the graph and in the right panel, then scrolls its row into view. */
export function goToCommit(sha: string): void {
  selectedSha.set(sha);
  showCommit(sha);
  scrollGraphTo(sha);
}

/**
 * Commit rows for `text`. A sha-looking text keeps only commits whose full sha
 * starts with it, so "#beef" finds that commit and not every subject with those letters.
 */
export function commitItems(text: string, commits: readonly CommitRow[]): PaletteItem[] {
  const pool = isShaQuery(text) ? commits.filter((c) => c.sha.startsWith(text.toLowerCase())) : commits;
  return pool.map((c) => ({
    id: `commit:${c.sha}`,
    title: `Go to commit ${c.sha.slice(0, 7)} ${c.subject}`,
    category: "Commit" as const,
    run: () => goToCommit(c.sha),
  }));
}
