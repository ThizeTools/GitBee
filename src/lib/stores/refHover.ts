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

/** The two refHover calls a badge makes, injectable so tests use a fake. */
export interface RefHoverPort {
  schedule(sha: string): void;
  release(sha: string): void;
}

const storePort: RefHoverPort = { schedule: scheduleRefHover, release: releaseRefHover };

// One badge's claim on the highlight. The badge keeps the sha it armed as a
// plain value and releases exactly that one. WHY: RefBadges used to release
// `primary.target_sha` in onDestroy, reading a $derived during teardown. On a
// direct switch between repo tabs the rows are destroyed after the stores
// moved to the new repo, so the badge's refs re-derived empty, `primary` was
// undefined, and the TypeError aborted Svelte's flush mid-update: a half-drawn
// graph, and after a few switches a blank one (2026-11, macOS report).
/** Example: `const claim = new RefHoverClaim(); claim.arm(sha); onDestroy(() => claim.release())` */
export class RefHoverClaim {
  private sha: string | null = null;

  constructor(private readonly port: RefHoverPort = storePort) {}

  /** Arms the highlight for `sha` on behalf of this badge. */
  arm(sha: string): void {
    this.sha = sha;
    this.port.schedule(sha);
  }

  /** Drops this badge's highlight, if it armed one. Safe to call twice. */
  release(): void {
    if (this.sha === null) return;
    this.port.release(this.sha);
    this.sha = null;
  }
}
