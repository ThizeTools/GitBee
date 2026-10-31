import { writable, get } from "svelte/store";

export const busy = writable<boolean>(false);

// Debounced/smoothed view of `busy` for UI overlays. Rising edges are
// delayed by BUSY_SHOW_DELAY so fast operations never flash the veil over
// the sidebar; falling edges by BUSY_HIDE_DELAY so a quick succession of
// git operations doesn't flicker it on/off between them. Use this in
// components, not raw `busy`. See docs/specs/repo-refresh.md.
export const busyVisible = writable<boolean>(false);
const BUSY_SHOW_DELAY = 250;
const BUSY_HIDE_DELAY = 350;
let busyShowTimer: ReturnType<typeof setTimeout> | null = null;
let busyHideTimer: ReturnType<typeof setTimeout> | null = null;
busy.subscribe((b) => {
  if (b) {
    if (busyHideTimer) { clearTimeout(busyHideTimer); busyHideTimer = null; }
    if (get(busyVisible) || busyShowTimer) return;
    busyShowTimer = setTimeout(() => { busyVisible.set(true); busyShowTimer = null; }, BUSY_SHOW_DELAY);
    return;
  }
  if (busyShowTimer) { clearTimeout(busyShowTimer); busyShowTimer = null; }
  if (busyHideTimer) clearTimeout(busyHideTimer);
  busyHideTimer = setTimeout(() => { busyVisible.set(false); busyHideTimer = null; }, BUSY_HIDE_DELAY);
});
