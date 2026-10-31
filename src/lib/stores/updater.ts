// Auto-update orchestration. Single source of truth for the status bar
// pill and any future surface that wants to show update progress.
//
// Flow:
//   1. App boots → bootUpdater() fires → check() against the manifest URL
//      configured in tauri.conf.json.
//   2. If a newer version is available, immediately starts download() in
//      the background — no user interaction. Progress is reported via
//      the `progress` store.
//   3. When the download finishes (and the .sig signature has been
//      verified by the plugin), state flips to "ready" with the new
//      version + notes. Status bar pill becomes clickable.
//   4. installNow() executes the staged installer + relaunches the app.
//
// Errors are non-fatal: the rest of the app keeps working, the pill
// just stays hidden (or shows a discreet warning when explicitly
// surfaced). We never block startup or interrupt the user.

import { writable, get } from "svelte/store";
import { logAppend } from "./logs";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string; notes: string | null }
  | { kind: "downloading"; version: string; progress: number }
  | { kind: "ready"; version: string; notes: string | null }
  | { kind: "error"; message: string };

export const updateState = writable<UpdateState>({ kind: "idle" });

// Lazy import so this module loads cleanly in non-Tauri contexts (eg.
// tests). The Tauri plugin pulls in webview APIs that aren't in jsdom.
type UpdaterMod = typeof import("@tauri-apps/plugin-updater");
type ProcessMod = typeof import("@tauri-apps/plugin-process");

let updater: UpdaterMod | null = null;
let processApi: ProcessMod | null = null;
async function loadModules() {
  if (!updater) updater = await import("@tauri-apps/plugin-updater");
  if (!processApi) processApi = await import("@tauri-apps/plugin-process");
}

let bootStarted = false;

export async function bootUpdater(): Promise<void> {
  if (bootStarted) return;
  bootStarted = true;
  // macOS checks too since v0.4.1: the release workflow publishes a
  // darwin-aarch64 entry in latest.json (docs/specs/release-and-updates.md).
  try {
    await loadModules();
    updateState.set({ kind: "checking" });
    const update = await updater!.check();
    if (!update) {
      updateState.set({ kind: "idle" });
      return;
    }
    const version = update.version;
    const notes = update.body ?? null;
    logAppend("info", `update available: v${version}`);
    updateState.set({ kind: "available", version, notes });

    // Immediately start downloading in background — user sees the pill
    // change to "Downloading…" then "Ready to install" when done.
    updateState.set({ kind: "downloading", version, progress: 0 });
    let total = 0;
    let received = 0;
    await update.download((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          break;
        case "Progress":
          received += event.data.chunkLength;
          if (total > 0) {
            const pct = Math.min(99, Math.round((received / total) * 100));
            updateState.set({ kind: "downloading", version, progress: pct });
          }
          break;
        case "Finished":
          updateState.set({ kind: "ready", version, notes });
          break;
      }
    });
    // Some platforms emit Finished, others don't — make sure we always
    // land in `ready` once download() resolves.
    const cur = get(updateState);
    if (cur.kind !== "ready") {
      updateState.set({ kind: "ready", version, notes });
    }
    logAppend("info", `update v${version} downloaded — ready to install`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logAppend("warn", `update check failed: ${msg}`);
    updateState.set({ kind: "error", message: msg });
  }
}

export async function installNow(): Promise<void> {
  try {
    await loadModules();
    const cur = get(updateState);
    if (cur.kind !== "ready") return;
    // Re-fetch the staged Update — `update` from `check()` lives only
    // until that call resolved. The plugin holds the downloaded artifact
    // internally; calling install() on a fresh check() is the official
    // pattern when we don't keep a reference around.
    const fresh = await updater!.check();
    if (!fresh) return;
    // Already downloaded once; downloadAndInstall() is idempotent — it
    // notices the artifact is staged and just installs.
    await fresh.downloadAndInstall();
    await processApi!.relaunch();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logAppend("error", `install failed: ${msg}`);
    updateState.set({ kind: "error", message: msg });
  }
}
