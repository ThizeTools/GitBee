import type { DiffLine } from "$lib/ipc";
import { wordDiffRanges, type CharRange } from "./wordDiff";

/** Indices into `Hunk.lines`: a removed line and the added line it pairs with. */
export interface LinePair { del: number; add: number; }

/**
 * Pairs the i-th removed line with the i-th added line of each run of removals
 * that git places directly before a run of additions, up to the shorter run.
 * Only paired lines get word-level highlighting: unrelated lines would produce
 * noisy word diffs. "\ No newline" markers are skipped because git puts them
 * between a removal and its replacement.
 */
export function pairChangedLines(lines: readonly DiffLine[]): LinePair[] {
  const body = bodyIndices(lines);
  const pairs: LinePair[] = [];
  let k = 0;
  while (k < body.length) {
    const delEnd = runEnd(lines, body, k, "del");
    if (delEnd === k) {
      k++;
      continue;
    }
    const addEnd = runEnd(lines, body, delEnd, "add");
    const count = Math.min(delEnd - k, addEnd - delEnd);
    for (let t = 0; t < count; t++) {
      pairs.push({ del: body[k + t], add: body[delEnd + t] });
    }
    k = addEnd;
  }
  return pairs;
}

/** Word-diff ranges for every paired line in a hunk, keyed by line index.
 *  Lines without changed words are absent from the map. */
export function wordRangesByLine(lines: readonly DiffLine[]): Map<number, CharRange[]> {
  const out = new Map<number, CharRange[]>();
  for (const { del, add } of pairChangedLines(lines)) {
    const ranges = wordDiffRanges(lines[del].content, lines[add].content);
    if (ranges.old.length > 0) out.set(del, ranges.old);
    if (ranges.new.length > 0) out.set(add, ranges.new);
  }
  return out;
}

/** Indices of every line except the "\ No newline" markers. */
function bodyIndices(lines: readonly DiffLine[]): number[] {
  const out: number[] = [];
  lines.forEach((line, i) => {
    if (line.kind !== "nonewline") out.push(i);
  });
  return out;
}

/** First position at or after `from` (in `body`) whose line is not `kind`. */
function runEnd(
  lines: readonly DiffLine[], body: readonly number[], from: number, kind: DiffLine["kind"],
): number {
  let k = from;
  while (k < body.length && lines[body[k]].kind === kind) k++;
  return k;
}
