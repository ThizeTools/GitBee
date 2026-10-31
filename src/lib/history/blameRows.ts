// Row models for the blame view: which lines are drawn, which one starts a
// group of lines from the same commit, and which shows the group's gutter info.
// Pure, so the rules are testable without rendering.
import type { BlameCommit, BlameLine, BlameResult } from "$lib/ipc";
import { ageBounds, ageOpacity, type AgeBounds } from "./age";
import type { RowRange } from "./virtualRange";

/** Height of one blame row in px. The view positions rows by it. */
export const BLAME_ROW_HEIGHT = 18;

/** One drawn line of the blame view. */
export interface BlameRowView {
  index: number;
  line: BlameLine;
  /** The first line of a run of lines from one commit. */
  startsGroup: boolean;
  /** Shows the commit's sha, author and date in the gutter. Group starts do, and so
   * does the first drawn row, so a group taller than the viewport keeps its info. */
  showInfo: boolean;
  /** Age bar opacity (see age.ts). Uncommitted lines are full strength. */
  opacity: number;
}

/** True for the all-zero sha git gives lines that are not committed yet. */
export function isUncommittedSha(sha: string): boolean {
  return sha.length > 0 && /^0+$/.test(sha);
}

/** Author times of the commits in `commits`, leaving out uncommitted lines. */
export function committedTimes(commits: Record<string, BlameCommit>): number[] {
  return Object.entries(commits)
    .filter(([sha]) => !isUncommittedSha(sha))
    .map(([, commit]) => commit.author_time);
}

/** True when line `index` begins a group: it is the first line, or the line
 * before it names another commit. */
export function startsGroup(lines: readonly BlameLine[], index: number): boolean {
  if (index === 0) return true;
  return lines[index - 1].sha !== lines[index].sha;
}

/**
 * Row models for the drawn range. `bounds` is the age range of the whole
 * blame (see `ageBounds(committedTimes(...))`), so a row's shade does not
 * depend on which rows are on screen.
 */
export function blameRowViews(
  result: BlameResult,
  range: RowRange,
  bounds: AgeBounds,
): BlameRowView[] {
  const views: BlameRowView[] = [];
  for (let index = range.first; index < range.end; index++) {
    const line = result.lines[index];
    const starts = startsGroup(result.lines, index);
    views.push({
      index,
      line,
      startsGroup: starts,
      showInfo: starts || index === range.first,
      opacity: opacityFor(line.sha, result.commits[line.sha], bounds),
    });
  }
  return views;
}

/** Uncommitted lines and lines without commit metadata are full strength. */
function opacityFor(sha: string, commit: BlameCommit | undefined, bounds: AgeBounds): number {
  if (!commit || isUncommittedSha(sha)) return 1;
  return ageOpacity(commit.author_time, bounds);
}

/** Age bounds for a whole blame result, from its committed commits. */
export function resultAgeBounds(result: BlameResult): AgeBounds {
  return ageBounds(committedTimes(result.commits));
}
