import { writable, get } from "svelte/store";

// Sha of the ref badge the pointer rests on, after a short dwell. The graph
// dims every row outside that commit's history (graph-columns-and-markers spec).
// The dwell keeps a pointer that is only passing over a badge from flashing
// the whole graph.
export const REF_HOVER_DELAY_MS = 150;

export const hoveredRefSha = writable<string | null>(null);

let timer: ReturnType<typeof setTimeout> | null = null;
let pendingSha: string | null = null;

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

// Arms the highlight for `sha`. Re-arming replaces a pending dwell, so moving
// across badges never leaves a stale highlight behind.
export function scheduleRefHover(sha: string): void {
  clearTimer();
  pendingSha = sha;
  timer = setTimeout(() => {
    timer = null;
    hoveredRefSha.set(sha);
  }, REF_HOVER_DELAY_MS);
}

// Called when the pointer leaves the badge of `sha`. Only clears state that
// belongs to that badge, so a late leave from one row cannot wipe the
// highlight another badge just set.
export function releaseRefHover(sha: string): void {
  if (pendingSha !== sha && get(hoveredRefSha) !== sha) return;
  clearTimer();
  pendingSha = null;
  hoveredRefSha.set(null);
}

// Unconditional clear, used on scroll start: rows move under a stationary
// pointer, so the badge the highlight came from may no longer be there.
export function clearRefHover(): void {
  clearTimer();
  pendingSha = null;
  hoveredRefSha.set(null);
}
