// Age shading for the blame gutter's bar. The newest commit in a blame gets
// full strength and the oldest keeps a floor, so an old line is still visible
// against the background. Pure: the caller passes the bounds it computed.

/** Weakest bar opacity: the oldest commit in a blame still shows. */
const FLOOR = 0.2;

export interface AgeBounds {
  oldest: number;
  newest: number;
}

/**
 * Oldest and newest author time (seconds) among `times`. An empty list gives
 * `{ oldest: 0, newest: 0 }`, which `ageOpacity` reads as "all the same age".
 * Usage: ageBounds([100, 300]) is `{ oldest: 100, newest: 300 }`.
 */
export function ageBounds(times: readonly number[]): AgeBounds {
  if (times.length === 0) return { oldest: 0, newest: 0 };
  let oldest = times[0];
  let newest = times[0];
  for (const t of times) {
    if (t < oldest) oldest = t;
    if (t > newest) newest = t;
  }
  return { oldest, newest };
}

/**
 * Opacity of one line's age bar, from FLOOR (the oldest time) to 1 (the
 * newest). Times outside the bounds are clamped. When every commit has the
 * same time, every bar is full. Usage: ageOpacity(300, 100, 300) is 1.
 */
export function ageOpacity(ts: number, bounds: AgeBounds): number {
  if (bounds.newest <= bounds.oldest) return 1;
  const t = (ts - bounds.oldest) / (bounds.newest - bounds.oldest);
  const clamped = Math.min(1, Math.max(0, t));
  return FLOOR + (1 - FLOOR) * clamped;
}
