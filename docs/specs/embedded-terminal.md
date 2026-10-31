# Embedded terminal (2026-10)

Neighbors: [keyboard-and-toasts.md](keyboard-and-toasts.md) (the Ctrl+` and
terminal key rows, and why graph keys stay off while the terminal has focus),
[ui-overhaul-2026-04.md](ui-overhaul-2026-04.md) (the older line-mode terminal
this spec replaces), [undo-history.md](undo-history.md) (repo tabs that own
their sessions).

## Purpose

1. GitBee had no terminal of its own. Ctrl+` opened the system terminal, which
   left the app and did not share the repo tab's context.
2. The earlier embedded terminal ran `cmd.exe` in pipe mode and rendered the
   output as text. It had no TTY, so programs got no colours, interactive
   programs failed, and `git log` or `git diff` could hang on the pager.
3. The goal is a real PTY docked at the bottom of the window, one set of
   sessions per repo tab, so the shell a user opens for a repo stays with that
   repo while they switch tabs.

## Public contract

### Backend commands (`src-tauri/src/commands/terminal.rs`)

| Command | Arguments | Returns | Errors |
|---|---|---|---|
| `terminal_spawn` | `path: String`, `cols: u16`, `rows: u16` | `u32` session id | `InvalidRepoPath` when `path` is not a directory; `Other("pty: …")` when the PTY cannot start |
| `terminal_write` | `id: u32`, `data: String` | `()` | `Other` naming the id when no live session has it |
| `terminal_resize` | `id: u32`, `cols: u16`, `rows: u16` | `()` | same as write |
| `terminal_kill` | `id: u32` | `()` | never fails; an unknown id is ignored |
| `open_terminal` | `path: String` | `()` | unchanged: opens the system terminal (Ctrl+Shift+`) |

Sizes are clamped to at least 1x1 on the backend.

### Events

| Event | Payload | Guarantees |
|---|---|---|
| `terminal-output` | `{ id: u32, data: string }` | UTF-8 text. Each event is at most 16 KB. A multibyte character split across PTY reads is kept whole. Output is coalesced within about 8 ms. |
| `terminal-exit` | `{ id: u32, code: number \| null }` | Sent once per session, after the output the shell produced before it exited (the reader gets up to 500 ms to drain). `code` is null when the process reports none. |

### Shell and environment

- Windows: `pwsh.exe` if it is on PATH (`-NoLogo`), else `powershell.exe`
  (`-NoLogo`), else `cmd.exe`.
- Other systems: `$SHELL`, else `/bin/bash`.
- Working directory: the repo path. Environment: inherited, plus
  `TERM=xterm-256color`.

### Frontend surface

- The dock sits at the bottom of the repo body, above the status bar. Its
  height is `layout.terminalHeight` (120 to 600 px, drag handle). Visibility is
  `layout.terminalOpen`. It is hidden on the new-tab and info pages.
- Tabs: one per session of the open repo. `+` starts a shell, `×` on a tab
  closes that shell, `⌄` hides the dock. Closing the repo's last tab hides the
  dock.
- Keys inside the terminal: Ctrl+Shift+C copies the selection, Ctrl+Shift+V
  pastes the clipboard. Ctrl+` (hide or show) and Ctrl+Shift+` (system terminal)
  are routed to the app. Every other key, including plain Ctrl+C, goes to the
  shell.
- Resize: a ResizeObserver fits the grid after a 50 ms pause and calls
  `terminal_resize` only when cols or rows changed.

### Module map

| Layer | File | Role |
|---|---|---|
| Backend trait | `src-tauri/src/pty/mod.rs` | `PtyBackend`, `PtySession`, `PtyChild`, value types |
| Backend impl | `src-tauri/src/pty/portable.rs` | the only file that names portable-pty |
| Shell choice | `src-tauri/src/pty/shell.rs` | pure chooser; PATH lookup is injected |
| Decoding | `src-tauri/src/pty/output.rs` | UTF-8 chunker with 16 KB bound |
| Threads | `src-tauri/src/pty/pump.rs` | reader, exit waiter, coalescing emitter |
| Sessions | `src-tauri/src/pty/manager.rs` | id map, spawn, write, resize, kill, kill_all |
| Frontend list | `src/lib/terminal/sessions.ts` | pure session state per repo |
| Frontend store | `src/lib/stores/terminal.ts` | IPC and events; closes sessions of closed tabs |
| Routing | `src/lib/terminal/outputRouter.ts`, `serialWriter.ts` | output backlog, ordered input |
| Keys | `src/lib/terminal/keys.ts` | pure key routing |
| Colours | `src/lib/terminal/theme.ts` | theme variables to xterm colours |
| Emulator | `src/lib/terminal/xtermView.ts` | the only file that imports `@xterm/*` |
| UI | `src/lib/components/TerminalPanel.svelte`, `TerminalSurface.svelte`, `MainArea.svelte` | dock, one surface per session, body layout |

## Invariants

- **Closing a repo tab ends its shells.** The store watches the tab list and
  kills the sessions of any repo that no tab shows.
- **Closing a session ends its shell.** The tab disappears at once, then
  `terminal_kill` runs. The repo's last tab closes the dock.
- **Quitting GitBee ends every shell.** `RunEvent::Exit` calls
  `PtyManager::kill_all`. Closing the window only hides it to the tray (existing
  behaviour), so shells keep running there.
- **Kill never blocks the UI.** `terminal_kill` removes the session from the map,
  calls `kill` on it, and returns. The kill itself only starts termination; the
  writer and master are released on a detached thread. Closing a ConPTY can wait
  for its output pipe to drain, so it is never done on a command thread.
- **The map lock is never held across a PTY call.** `write`, `resize`, `kill`
  and every thread join run after the lock is released. This is the lesson of
  commit 036f930: a lock held across `wait()` made `terminal_kill` hang forever.
- **Input reaches the shell in order.** Each keystroke is its own IPC call, so
  the frontend queues writes (`serialWriter.ts`). Tauri may run calls out of
  order, and that would scramble typed text.
- **Output is not lost while a surface is detached.** Output for a session that
  has no attached view waits in a backlog of at most 200 000 characters, and the
  newest characters win. The backlog is replayed when the view attaches.
- **Sessions survive a hidden dock and repo switches.** Every session's surface
  stays mounted. Hidden surfaces are `display: none` and do not fit (a zero-size
  host would otherwise report a 2x1 grid).
- **The exit notice follows the last output.** The waiter gives the reader up to
  500 ms to drain after the shell exits, and the exit event is sent after that.
- **Graph keys stay off while the terminal has focus.** xterm types into a hidden
  `<textarea>`, which `isEditableTarget` treats as text input. Escape inside the
  terminal is not consumed by the center view.
- **Ctrl+W reaches the shell while the terminal has focus.** It is delete-word
  there, and closing the tab would end the repo's shells. The other app Ctrl
  shortcuts (palette, logs, tab switching) still fire from the terminal.
- **A session id is never reused in one app run.** Ids come from an atomic
  counter and are never recycled, so a stale id gets an error, not another shell.

## Out of scope

- Split panes inside the dock.
- A shell profile picker. The shell is chosen by the rules above, with no UI to
  change it.
- Scrollback that survives an app restart. Scrollback lives in the xterm
  instance and is discarded with the session.
- Killing grandchildren. Only the shell process is killed. A program the shell
  started may survive on Windows if it ignores the console close.
- Keeping shells running across an app crash. The exit path runs only on a
  normal exit.

## Rejected alternatives

- **The line-mode `cmd.exe` pipe (previous design).** No TTY means no colours,
  no curses or other interactive programs, and pagers (git log, git diff) hang
  waiting for input the pipe never delivers.
- **node-pty.** It is the usual choice in Electron apps, but it needs a Node
  runtime, which a Tauri app does not ship.
- **tauri-plugin-shell.** It runs commands and streams their output. It does not
  provide a PTY, so the same TTY problems return.
- **One xterm instance re-created on each tab switch.** Switching repos would
  lose scrollback and any output printed while the dock was hidden, and a
  long-running build would look idle when the user came back.
- **Timer-driven coalescing inside the reader thread.** A blocking `read` cannot
  time out, so the reader would hold output until the next byte arrived. A
  separate emitter thread with `recv_timeout` flushes on time.
- **Keeping the child behind a lock for the exit watcher (036f930).** The watcher
  held the lock across `wait()`, so kill could not get it and blocked forever.
  Owning the child on one thread and killing through a separate killer handle
  has no shared lock to block on.
- **portable-pty 0.9.0.** Newer than the pinned 0.8.1. The wrapper was written and
  tested against 0.8.1, so the pin stays until the wrapper is checked against
  0.9. The pin is `=0.8.1` in `src-tauri/Cargo.toml`.
