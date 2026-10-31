// Keeps GraphCanvas's scrollTop state in step with the scroll container's real
// offset, and reports scroll-to-sha requests for commits outside the loaded
// slice. The virtual row window is computed from the state, so the state must
// match the DOM (graph-loading spec, render section).

// Differences under one pixel are sub-pixel rounding from a zoomed (fractional)
// offset, not a clamp, so they do not trigger a resync.
const RESYNC_THRESHOLD_PX = 1;

// WHY: WebKit clamps scrollTop when the spacer shrinks (fewer commits, or
// another repo tab) and does not fire a scroll event. A state larger than the
// DOM starts the window a few rows too low, so the top rows lose their avatar
// and text while the canvas still draws their lanes. Bug: tab switch.
//
// Usage: `if (shouldResyncScroll(scrollTop, el.scrollTop)) scrollTop = el.scrollTop;`
export function shouldResyncScroll(stateTop: number, domTop: number): boolean {
  return Math.abs(domTop - stateTop) >= RESYNC_THRESHOLD_PX;
}

// Logs a scroll-to-sha request for a commit outside the loaded slice, so the
// missing scroll is visible in the log panel.
export function logMissingScrollTarget(sha: string): void {
  // Imported lazily to avoid pulling logs into a hot path.
  import("$lib/stores/logs").then(({ logAppend }) =>
    logAppend("warn", `commit ${sha.slice(0, 7)} not in current graph slice`)
  );
}
