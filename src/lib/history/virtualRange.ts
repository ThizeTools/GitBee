// Which rows of a fixed-height list to draw. The blame view keeps a row per
// line, so a 50k-line file draws only the rows on screen plus a margin.

/** Rows to draw: indexes `first` up to, not including, `end`. */
export interface RowRange {
  first: number;
  end: number;
}

/** Rows drawn beyond each edge of the viewport, so a fast scroll shows no gap. */
export const DEFAULT_OVERSCAN = 10;

/**
 * Range of rows visible in a viewport, widened by `overscan` on each side and
 * clamped to `0..count`. A negative scroll or size counts as zero.
 * Usage: visibleRows(0, 100, 18, 1000) is `{ first: 0, end: 16 }`.
 */
export function visibleRows(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan: number = DEFAULT_OVERSCAN,
): RowRange {
  if (count <= 0 || rowHeight <= 0) return { first: 0, end: 0 };
  const top = Math.max(0, scrollTop);
  const height = Math.max(0, viewportHeight);
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const end = Math.ceil((top + height) / rowHeight) + overscan;
  return { first: Math.min(first, count), end: Math.min(end, count) };
}
