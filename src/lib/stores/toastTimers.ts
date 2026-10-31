// Pure bookkeeping for toast auto-dismiss: how much time a toast has left and
// which toast to evict when the stack is full. The notifications store owns the
// real timers and the store writes; nothing here touches the DOM or timers.

/** Most toasts on screen at once. A new one past this evicts an older one. */
export const MAX_VISIBLE_TOASTS = 5;

export interface ToastSlot {
  id: number;
  kind: "info" | "success" | "warn" | "error";
}

/** Id of the toast to evict before one more is added, or null when there is
 * room. Prefers the oldest non-error toast so errors stay readable; when every
 * visible toast is an error, the oldest goes. `slots` is in arrival order.
 * Example: pickEvictedToast(fiveSlots) → the first non-error id, or the first id */
export function pickEvictedToast(
  slots: readonly ToastSlot[],
  max: number = MAX_VISIBLE_TOASTS,
): number | null {
  if (slots.length < max) return null;
  const oldestNonError = slots.find((s) => s.kind !== "error");
  return (oldestNonError ?? slots[0]).id;
}

/** Milliseconds left after a timer that had `remainingMs` left ran from
 * `since` until `now`. Clamped at 0. Used when a hovered toast resumes: the
 * remainder is kept and the timer restarts with it.
 * Example: remainingAfterRun(5000, 1000, 1800) → 4200 */
export function remainingAfterRun(remainingMs: number, since: number, now: number): number {
  return Math.max(0, remainingMs - Math.max(0, now - since));
}
