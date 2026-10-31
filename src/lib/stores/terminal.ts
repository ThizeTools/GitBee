// Embedded terminal state: the sessions, the tab each repo shows, and the
// event plumbing from the backend to the xterm surfaces. The list logic lives
// in terminal/sessions.ts; this file does IPC and events only.
// Design: docs/specs/embedded-terminal.md.

import { writable, derived, get } from "svelte/store";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "$lib/ipc";
import { currentRepo, tabs, samePath } from "$lib/stores/repoState";
import { logAppend } from "$lib/stores/logs";
import {
  NO_SESSIONS, activeSessionId, addSession, exitNotice, markExited, nextTitle,
  orphanedSessionIds, removeSession, selectSession, sessionsOf,
  type TerminalSessions,
} from "$lib/terminal/sessions";
import { OutputRouter } from "$lib/terminal/outputRouter";
import { createSerialWriter } from "$lib/terminal/serialWriter";

/** Size used at spawn. The surface resizes to the real grid right after mounting. */
const SPAWN_COLS = 80;
const SPAWN_ROWS = 24;

export const terminalSessions = writable<TerminalSessions>(NO_SESSIONS);

/** Sessions of the open repo tab, in creation order. */
export const repoSessions = derived([terminalSessions, currentRepo], ([$s, $repo]) =>
  $repo ? sessionsOf($s, $repo) : [],
);

/** Id of the session the dock shows for the open repo, or null. */
export const shownSessionId = derived([terminalSessions, currentRepo], ([$s, $repo]) =>
  $repo ? activeSessionId($s, $repo) : null,
);

interface OutputEvent { id: number; data: string; }
interface ExitEvent { id: number; code: number | null; }

const router = new OutputRouter();

/** Connects a session's xterm view. Output buffered before this call is replayed. */
export function attachOutputSink(id: number, sink: (data: string) => void): void {
  router.attach(id, sink);
}

export function detachOutputSink(id: number): void {
  router.detach(id);
}

const sendInputQueued = createSerialWriter(
  async (id, data) => {
    await ipc.terminalWrite(id, data);
  },
  (message) => logAppend("error", message),
);

/** Sends keystrokes or pasted text to a live session. Input for an exited
 * session is dropped, because its exit notice is already on screen. */
export function sendInput(id: number, data: string): void {
  if (isLive(id)) sendInputQueued(id, data);
}

/** Reports the grid size to the backend. Failures are logged, not shown as toasts. */
export function resizeSession(id: number, cols: number, rows: number): void {
  ipc.terminalResize(id, cols, rows).catch((err) => logAppend("error", `terminal resize: ${err}`));
}

function isLive(id: number): boolean {
  return get(terminalSessions).list.some((s) => s.id === id && !s.exited);
}

let listening: Promise<void> | null = null;

/** Registers the backend event listeners once. Also closes shells whose repo
 * tab is gone, so closing a tab ends its terminals. */
export function ensureTerminalListeners(): Promise<void> {
  // A failed registration is forgotten so the next open can retry it.
  listening ??= registerListeners().catch((err) => {
    listening = null;
    throw err;
  });
  return listening;
}

async function registerListeners(): Promise<void> {
  await listen<OutputEvent>("terminal-output", (e) => router.deliver(e.payload.id, e.payload.data));
  await listen<ExitEvent>("terminal-exit", (e) => handleExit(e.payload));
  tabs.subscribe((list) => closeOrphans(list.map((t) => t.path)));
}

function handleExit(payload: ExitEvent): void {
  terminalSessions.update((s) => markExited(s, payload.id));
  router.deliver(payload.id, exitNotice(payload.code));
}

function closeOrphans(openPaths: string[]): void {
  const isOpen = (repo: string): boolean => openPaths.some((p) => samePath(p, repo));
  for (const id of orphanedSessionIds(get(terminalSessions), isOpen)) {
    void closeSession(id);
  }
}

const starting = new Set<string>();

/** Starts a shell in `repo` and makes it the active tab. Returns the new id, or
 * null when the start failed (logged) or the repo is already starting. */
export async function openSession(repo: string): Promise<number | null> {
  if (starting.has(repo)) return null;
  starting.add(repo);
  try {
    await ensureTerminalListeners();
    const id = await ipc.terminalSpawn(repo, SPAWN_COLS, SPAWN_ROWS);
    terminalSessions.update((s) =>
      addSession(s, { id, repo, title: nextTitle(s, repo), exited: false }),
    );
    return id;
  } catch (err) {
    logAppend("error", `terminal start: ${err}`);
    return null;
  } finally {
    starting.delete(repo);
  }
}

/** Ends a session: its tab disappears at once, then the shell is killed. The
 * kill call returns immediately on the backend, so the UI never waits on it. */
export async function closeSession(id: number): Promise<void> {
  if (!get(terminalSessions).list.some((s) => s.id === id)) return;
  terminalSessions.update((s) => removeSession(s, id));
  router.drop(id);
  try {
    await ipc.terminalKill(id);
  } catch (err) {
    logAppend("error", `terminal close: ${err}`);
  }
}

/** Shows a session as the active tab of its repo. */
export function selectTerminal(repo: string, id: number): void {
  terminalSessions.update((s) => selectSession(s, repo, id));
}
