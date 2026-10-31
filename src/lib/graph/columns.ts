// Column ids, visibility and migration for the graph header and rows. Pure:
// the layout store persists the result and GraphCanvas / GraphHeader read it.
// See docs/specs/graph-columns-and-markers.md for why the stored order keeps
// hidden columns and why graph and msg can never be hidden.

export type GraphCol = "refs" | "graph" | "msg" | "author" | "date" | "sha" | "changes";

export const DEFAULT_COL_ORDER: readonly GraphCol[] = ["refs", "graph", "msg", "author", "date", "sha", "changes"];
// changes is hidden because it costs git work (commit_stats) for every visible row.
export const DEFAULT_HIDDEN_COLS: readonly GraphCol[] = ["sha", "changes"];

// Lanes and subjects are the point of the graph; hiding them would leave
// nothing to read, so they are always visible.
const LOCKED_COLS: readonly GraphCol[] = ["graph", "msg"];

// Minimum width a user can drag a column to. Graph keeps its own larger floor
// so lanes never clip; the new text columns can shrink further.
export const COL_MIN_WIDTH: Record<GraphCol, number> = {
  refs: 80, graph: 80, msg: 80, author: 50, date: 50, sha: 50, changes: 70,
};

export type ColWidthKey =
  | "graphRefsWidth" | "graphWidth" | "graphMsgWidth"
  | "graphAuthorWidth" | "graphDateWidth" | "graphShaWidth" | "graphChangesWidth";

// Width key in LayoutState for each column; keeps the header/row code free of
// per-column switch statements.
export const COL_WIDTH_KEY: Record<GraphCol, ColWidthKey> = {
  refs: "graphRefsWidth",
  graph: "graphWidth",
  msg: "graphMsgWidth",
  author: "graphAuthorWidth",
  date: "graphDateWidth",
  sha: "graphShaWidth",
  changes: "graphChangesWidth",
};

export function isGraphCol(value: unknown): value is GraphCol {
  return typeof value === "string" && (DEFAULT_COL_ORDER as readonly string[]).includes(value);
}

export function isLockedCol(col: GraphCol): boolean {
  return LOCKED_COLS.includes(col);
}

// A stored order written before a column existed lacks it. Missing columns are
// appended in default order, so an upgraded user sees author/date after msg
// and sha and changes at the end (sha and changes hidden by default). Unknown
// and duplicate ids are dropped.
export function migrateColOrder(stored: unknown): GraphCol[] {
  if (!Array.isArray(stored)) return [...DEFAULT_COL_ORDER];
  const out: GraphCol[] = [];
  for (const value of stored) {
    if (isGraphCol(value) && !out.includes(value)) out.push(value);
  }
  for (const col of DEFAULT_COL_ORDER) {
    if (!out.includes(col)) out.push(col);
  }
  return out;
}

// Stored hidden list with locked columns removed, unknown ids dropped and
// duplicates collapsed. A missing list (layout written before hiding existed)
// falls back to the defaults.
export function normalizeHidden(stored: unknown): GraphCol[] {
  if (!Array.isArray(stored)) return [...DEFAULT_HIDDEN_COLS];
  const out: GraphCol[] = [];
  for (const value of stored) {
    if (isGraphCol(value) && !LOCKED_COLS.includes(value) && !out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}

// A default-hidden column that the stored order lacks is new to this install.
// The stored hidden list was written before it existed, so it does not mention
// the column, and without this step the new column would show up for upgraders.
// Callers pass the raw stored order, before migrateColOrder fills it in.
export function hideNewDefaults(hidden: readonly GraphCol[], storedOrder: unknown): GraphCol[] {
  if (!Array.isArray(storedOrder)) return [...hidden];
  const out: GraphCol[] = [...hidden];
  for (const col of DEFAULT_HIDDEN_COLS) {
    if (!storedOrder.includes(col) && !out.includes(col)) out.push(col);
  }
  return out;
}

// Columns in layout order that are not hidden: the list the grid template
// and the rows are built from. The last entry of this list takes the 1fr track.
export function visibleCols(order: readonly GraphCol[], hidden: readonly GraphCol[]): GraphCol[] {
  return order.filter((col) => !hidden.includes(col));
}

// Next hidden list after a checkbox click. Locked columns never change, so a
// stale click on them is a no-op rather than an error.
export function toggleHidden(hidden: readonly GraphCol[], col: GraphCol): GraphCol[] {
  if (LOCKED_COLS.includes(col)) return [...hidden];
  return hidden.includes(col)
    ? hidden.filter((c) => c !== col)
    : [...hidden, col];
}
