import { writable, get } from "svelte/store";
import { ipc } from "$lib/ipc";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const MAX_BYTES = 200_000;

export const termText = writable<string>("");
export const termRunning = writable<boolean>(false);
export const termSessionId = writable<string | null>(null);

let unlistenOut: UnlistenFn | null = null;
let unlistenExit: UnlistenFn | null = null;

export async function startTerminal(cwd: string): Promise<void> {
  await stopTerminal();
  termText.set("");
  unlistenOut = await listen<{ id: string; chunk: string }>("terminal-output", (e) => {
    if (e.payload.id !== get(termSessionId)) return;
    termText.update((t) => {
      const next = t + e.payload.chunk;
      return next.length > MAX_BYTES ? next.slice(next.length - MAX_BYTES) : next;
    });
  });
  unlistenExit = await listen<{ id: string; code: number | null }>("terminal-exit", (e) => {
    if (e.payload.id !== get(termSessionId)) return;
    termText.update((t) => t + `\n[process exited${e.payload.code !== null ? ` with code ${e.payload.code}` : ""}]\n`);
    termRunning.set(false);
  });
  const id = await ipc.terminalSpawn(cwd);
  termSessionId.set(id);
  termRunning.set(true);
}

export async function writeTerminal(line: string): Promise<void> {
  const id = get(termSessionId);
  if (!id) return;
  await ipc.terminalWrite(id, line + "\n");
  termText.update((t) => t + line + "\n");
}

export async function stopTerminal(): Promise<void> {
  const id = get(termSessionId);
  if (id) { try { await ipc.terminalKill(id); } catch { /* ignore */ } }
  if (unlistenOut) { unlistenOut(); unlistenOut = null; }
  if (unlistenExit) { unlistenExit(); unlistenExit = null; }
  termSessionId.set(null);
  termRunning.set(false);
}
