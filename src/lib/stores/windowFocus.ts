import { pauseWatcher, resumeWatcher } from "$lib/stores/repo";

// While GitBee is in the background the repo watcher is stopped: that
// releases its OS directory handle (Windows reported it as "file in use
// by GitBee" when moving/renaming the repo from Explorer) and stops
// refresh churn nobody is looking at. Focus resumes it and catches up
// with one silent refresh. See docs/specs/repo-refresh.md.
let started = false;

/** Installs the blur/focus listeners once. Example: call from onMount. */
export function startFocusWatchPause(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("blur", () => { void pauseWatcher(); });
  window.addEventListener("focus", () => { void resumeWatcher(); });
}
