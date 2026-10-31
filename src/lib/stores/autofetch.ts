import { get } from "svelte/store";
import { ipc } from "$lib/ipc";
import { activeTab, busy, refreshActive } from "$lib/stores/repo";

// Periodic background `git fetch --all --prune` so remote-tracking refs
// (e.g. origin/gh-pages updated by external tools like the `gh-pages` npm
// package) advance without the user having to click Pull. Five minutes is
// a compromise between staleness and rate-limiting upstreams.
//
// Window focus also triggers an opportunistic fetch — when the user
// switches back to GitBee from a terminal/editor where they may have
// pushed externally, they expect the graph to reflect that work without
// a 5-minute wait. We rate-limit focus-fetches to once per FOCUS_MIN_MS
// to avoid hammering origin if the user alt-tabs repeatedly.
const INTERVAL_MS = 5 * 60 * 1000;
const FOCUS_MIN_MS = 30 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let focusListener: (() => void) | null = null;
let lastFocusFetch = 0;
let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  // A background fetch must not race a user's pull/push/commit for refs or
  // index.lock; it runs on the next tick instead. See docs/specs/repo-refresh.md.
  if (get(busy)) return;
  const t = get(activeTab);
  if (!t || t.kind === "newtab" || !t.path) return;
  inFlight = true;
  try {
    await ipc.remoteFetch(t.path);
    // Silent: a background fetch must not cover the sidebar with the veil
    // (it used to, right when the user came back to the window to click).
    await refreshActive({ silent: true });
  } catch {
    // Silent — offline, auth prompt, etc. Next tick will retry.
  } finally {
    inFlight = false;
  }
}

function onFocus(): void {
  const now = Date.now();
  if (now - lastFocusFetch < FOCUS_MIN_MS) return;
  lastFocusFetch = now;
  void tick();
}

export function startAutoFetch(): void {
  if (timer) return;
  timer = setInterval(tick, INTERVAL_MS);
  if (typeof window !== "undefined" && !focusListener) {
    focusListener = onFocus;
    window.addEventListener("focus", focusListener);
  }
}

export function stopAutoFetch(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (focusListener && typeof window !== "undefined") {
    window.removeEventListener("focus", focusListener);
    focusListener = null;
  }
}
