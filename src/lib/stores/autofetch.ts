import { get } from "svelte/store";
import { ipc } from "$lib/ipc";
import { activeTab, refreshActive } from "$lib/stores/repo";

// Periodic background `git fetch --all --prune` so remote-tracking refs
// (e.g. origin/gh-pages updated by external tools like the `gh-pages` npm
// package) advance without the user having to click Pull. Five minutes is
// a compromise between staleness and rate-limiting upstreams.
const INTERVAL_MS = 5 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  const t = get(activeTab);
  if (!t || t.kind === "newtab" || !t.path) return;
  inFlight = true;
  try {
    await ipc.remoteFetch(t.path);
    await refreshActive();
  } catch {
    // Silent — offline, auth prompt, etc. Next tick will retry.
  } finally {
    inFlight = false;
  }
}

export function startAutoFetch(): void {
  if (timer) return;
  timer = setInterval(tick, INTERVAL_MS);
}

export function stopAutoFetch(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
