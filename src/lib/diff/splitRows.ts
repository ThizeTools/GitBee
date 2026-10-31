import type { DiffLine, Hunk, LineKind } from "$lib/ipc";
import { pairChangedLines } from "./linePairs";

/** One side of a side-by-side row. `index` points back into `Hunk.lines`, so the
 *  view looks up word ranges and content without copying them twice. */
export interface SplitCell {
  kind: LineKind;
  no: number | null;
  index: number;
  content: string;
}

/** A row of the split view. A null side is an empty cell on that side. */
export interface SplitRow { left: SplitCell | null; right: SplitCell | null; }

/**
 * Lays one hunk out as side-by-side rows. Context lines fill both sides, a
 * removal and its paired addition share a row, and an unpaired line leaves the
 * opposite side empty. A "\ No newline" marker sits on the side of the line
 * before it. Usage: toSplitRows(hunk)[0].left is the first old-side cell.
 */
export function toSplitRows(hunk: Hunk): SplitRow[] {
  const lines = hunk.lines;
  const addOfDel = new Map<number, number>();
  const pairedAdds = new Set<number>();
  for (const p of pairChangedLines(lines)) {
    addOfDel.set(p.del, p.add);
    pairedAdds.add(p.add);
  }
  const rows: SplitRow[] = [];
  lines.forEach((_, i) => {
    const row = rowAt(lines, i, addOfDel, pairedAdds);
    if (row) rows.push(row);
  });
  return rows;
}

/** Row emitted for line `i`, or null when the line already shares a row. */
function rowAt(
  lines: readonly DiffLine[],
  i: number,
  addOfDel: ReadonlyMap<number, number>,
  pairedAdds: ReadonlySet<number>,
): SplitRow | null {
  const line = lines[i];
  switch (line.kind) {
    case "context":
      return { left: cellOf(lines, i, "old"), right: cellOf(lines, i, "new") };
    case "del": {
      const add = addOfDel.get(i);
      return {
        left: cellOf(lines, i, "old"),
        right: add === undefined ? null : cellOf(lines, add, "new"),
      };
    }
    case "add":
      return pairedAdds.has(i) ? null : { left: null, right: cellOf(lines, i, "new") };
    case "nonewline":
      return markerRow(lines, i);
  }
}

function cellOf(lines: readonly DiffLine[], i: number, side: "old" | "new"): SplitCell {
  const line = lines[i];
  return {
    kind: line.kind,
    no: side === "old" ? line.old_no : line.new_no,
    index: i,
    content: line.content,
  };
}

/** A "\ No newline" marker is shown on the side(s) of the line before it. */
function markerRow(lines: readonly DiffLine[], i: number): SplitRow | null {
  let j = i - 1;
  while (j >= 0 && lines[j].kind === "nonewline") j--;
  if (j < 0) return null;
  const marker: SplitCell = { kind: "nonewline", no: null, index: i, content: lines[i].content };
  switch (lines[j].kind) {
    case "del": return { left: marker, right: null };
    case "add": return { left: null, right: marker };
    case "context":
    case "nonewline":
      return { left: marker, right: marker };
  }
}
