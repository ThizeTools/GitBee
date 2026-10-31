// Session list for the embedded terminal, as pure functions over plain data.
// The store (stores/terminal.ts) wraps these with IPC and events. Sessions
// belong to a repo path; each repo remembers which of its tabs is active.

export interface TerminalSession {
  /** Backend session id from terminal_spawn. */
  id: number;
  /** Repo path the shell started in. */
  repo: string;
  title: string;
  /** The shell exited on its own; the tab stays until closed. */
  exited: boolean;
}

export interface TerminalSessions {
  list: TerminalSession[];
  /** Active session id per repo path. */
  activeByRepo: Record<string, number>;
}

export const NO_SESSIONS: TerminalSessions = { list: [], activeByRepo: {} };

/** Output kept for a session before its view attaches. Bounded so an unattended
 * session cannot grow memory without limit. */
export const BACKLOG_LIMIT_CHARS = 200_000;

/** Sessions of one repo, in creation order. */
export function sessionsOf(state: TerminalSessions, repo: string): TerminalSession[] {
  return state.list.filter((s) => s.repo === repo);
}

/** The session shown for a repo: the remembered one when it still exists,
 * otherwise the first session of that repo. Null when the repo has none.
 * Example: activeSessionId(state, "/repo") → 3 */
export function activeSessionId(state: TerminalSessions, repo: string): number | null {
  const own = sessionsOf(state, repo);
  const remembered = state.activeByRepo[repo];
  if (own.some((s) => s.id === remembered)) return remembered;
  return own[0]?.id ?? null;
}

/** Adds a session and makes it the active one for its repo. */
export function addSession(state: TerminalSessions, session: TerminalSession): TerminalSessions {
  return {
    list: [...state.list, session],
    activeByRepo: { ...state.activeByRepo, [session.repo]: session.id },
  };
}

/** Removes a session and forgets it as active. Unknown ids leave the state unchanged. */
export function removeSession(state: TerminalSessions, id: number): TerminalSessions {
  const gone = state.list.find((s) => s.id === id);
  if (!gone) return state;
  const activeByRepo = { ...state.activeByRepo };
  if (activeByRepo[gone.repo] === id) delete activeByRepo[gone.repo];
  return { list: state.list.filter((s) => s.id !== id), activeByRepo };
}

/** Makes a session the active tab of its repo. */
export function selectSession(state: TerminalSessions, repo: string, id: number): TerminalSessions {
  return { ...state, activeByRepo: { ...state.activeByRepo, [repo]: id } };
}

/** Marks a session as exited. The tab stays so the user can read the output. */
export function markExited(state: TerminalSessions, id: number): TerminalSessions {
  return {
    ...state,
    list: state.list.map((s) => (s.id === id ? { ...s, exited: true } : s)),
  };
}

/** Title for a new tab: "Terminal N", where N counts the repo's tabs plus one.
 * Example: nextTitle(state with 1 tab for the repo, repo) → "Terminal 2" */
export function nextTitle(state: TerminalSessions, repo: string): string {
  return `Terminal ${sessionsOf(state, repo).length + 1}`;
}

/** Ids of sessions whose repo no longer has an open tab. Those shells are killed
 * when their tab closes. `isOpen` answers whether a repo path is still open. */
export function orphanedSessionIds(
  state: TerminalSessions,
  isOpen: (repo: string) => boolean,
): number[] {
  return state.list.filter((s) => !isOpen(s.repo)).map((s) => s.id);
}

/** The line written into the terminal when a shell exits. xterm needs CRLF. */
export function exitNotice(code: number | null): string {
  const detail = code === null ? "" : ` with code ${code}`;
  return `\r\n[process exited${detail}]\r\n`;
}

/** Appends `add` to `text`, keeping only the newest `limit` characters. */
export function appendCapped(text: string, add: string, limit: number): string {
  const joined = text + add;
  return joined.length > limit ? joined.slice(joined.length - limit) : joined;
}
