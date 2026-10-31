// Key routing for the embedded terminal. Pure: no DOM or store imports, so
// bun test can exercise it with plain objects. See docs/specs/embedded-terminal.md.

/** The KeyboardEvent fields the routing reads. */
export interface TerminalKeyEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Where a keydown goes before xterm sees it.
 * copy / paste: GitBee's clipboard shortcuts (xterm must not send them to the shell).
 * app: Ctrl+` and Ctrl+Shift+`, which the app owns (dock toggle, OS terminal).
 * shell: every other key, sent to the shell as usual. */
export type TerminalKeyRoute = "copy" | "paste" | "app" | "shell";

/** Classifies one keydown. Ctrl+Shift+C and Ctrl+Shift+V are the only clipboard
 * keys: plain Ctrl+C must stay SIGINT for the running program.
 * Example: terminalKeyRoute({ key: "C", ctrlKey: true, shiftKey: true, ... }) → "copy" */
export function terminalKeyRoute(e: TerminalKeyEvent): TerminalKeyRoute {
  if (e.altKey || e.metaKey || !e.ctrlKey) return "shell";
  if (isBacktick(e)) return "app";
  if (!e.shiftKey) return "shell";
  const key = e.key.toLowerCase();
  if (key === "c") return "copy";
  if (key === "v") return "paste";
  return "shell";
}

/** True for the backtick key. Shift turns it into "~" on US layouts, so the
 * physical code is checked too. */
export function isBacktick(e: Pick<TerminalKeyEvent, "key" | "code">): boolean {
  return e.key === "`" || e.key === "~" || e.code === "Backquote";
}

/** Structural subset of an event target, so tests can pass plain objects. */
export interface TargetLike {
  closest?: (selector: string) => unknown;
}

/** True when a key event starts inside the terminal dock. The page-level
 * handler uses it so Escape and similar keys stay with the shell.
 * Example: isTerminalTarget({ closest: () => ({}) }) → true */
export function isTerminalTarget(target: TargetLike | null): boolean {
  return typeof target?.closest === "function" && target.closest(".terminal-surface") != null;
}
