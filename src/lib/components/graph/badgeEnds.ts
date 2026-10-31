// Measures where each row's ref badge ends, in canvas-space CSS px, so the
// renderer's connector stops at the pill instead of overshooting it. DOM reads
// only: GraphCanvas calls this when rows or layout change, never per scroll
// pixel (graph-loading spec, render section).

// Returns row -> canvas x of the badge's right edge. Rows whose badge is not
// rendered (no refs, or width 0) are absent, and the renderer then runs the
// connector to the canvas edge.
export function measureBadgeEnds(
  scrollEl: HTMLElement,
  wipVisible: boolean,
  scale: number,
): Map<number, number> {
  // getBoundingClientRect is in viewport (post-zoom) px and the canvas sits in
  // the same zoomed container, so deltas are divided by the zoom to get CSS px.
  const parentRect = scrollEl.getBoundingClientRect();
  const wipShiftRow = wipVisible ? 1 : 0;
  const next = new Map<number, number>();
  const cells = scrollEl.querySelectorAll<HTMLElement>(".cell-refs[data-row]");
  for (const cell of cells) {
    const visibleRow = Number(cell.dataset.row ?? -1);
    // The WIP row's badge is drawn separately, so it has no node index.
    if (visibleRow < 0 || (wipVisible && visibleRow === 0)) continue;
    const badge = cell.querySelector<HTMLElement>(".badges, .wip-inline");
    if (!badge) continue;
    const r = badge.getBoundingClientRect();
    if (r.width === 0) continue;
    // The renderer keys on node index, so drop the WIP shift.
    next.set(visibleRow - wipShiftRow, (r.right - parentRect.left) / scale);
  }
  return next;
}
