# UI overhaul (2026-04)

Twenty UX changes requested in one batch. Documented here so the diff has
a single source of intent. Each numbered item maps to the user request.

## Purpose
Make the client feel closer to GitKraken: explicit panels, resizable
everywhere, persistent layout, contextual menus, and a status bar.

## Scope (numbered items)

1. **Commit click → right panel only.** Selecting a commit/stash/etc.
   in the graph updates the right-hand panel (commit details there),
   not the center. Center only switches when a *file* is opened.
2. **File view = full file.** "File View" tab in DiffPanel shows the
   current file contents, not just the diff hunks.
3. **Stash right-click in graph.** Menu: Apply, Pop, Delete, Edit
   message, Hide.
4. **Stash in sidebar.** Left-click → load stash details in right
   panel (replaces Changes view temporarily). Right-click → same menu
   as #3.
5. **Graph columns separators / reorder / resize.** Branch/Tag, Graph,
   Commit Message columns each have visible borders, draggable
   dividers, persisted widths.
6. **Commit message left-aligned.** Commit message column starts
   immediately to the right of the graph cell.
7. **Ctrl +/- zoom.** Adjusts UI zoom (CSS `--ui-scale`).
8. **Bottom status bar.** Right-aligned items: Logs button (opens
   Application/Repository tabs), Shortcuts button, zoom indicator
   (clickable: 80/90/100/110/120/130), app version.
9. **Replace Fetch with Undo/Redo.** Disabled-looking when
   unavailable. Stash/Pop also show disabled state when no stashes.
10. **Integrated terminal.** Bottom of center pane (~30% default,
    resizable). Toggle with terminal button.
11. **Repo tabs with "+".** Last tab is always a "+" that opens a
    "New Tab" page with `# Repositories` (Open / Clone / Create) and
    a Recent list.
12. **Single Stage/Unstage button on hover.** Replaces the two small
    buttons. Green for Stage, red for Unstage.
13. **File context menu.** Stage/Unstage, Discard Changes, Ignore
    (file or `*.ext`), Stash File, File History, File Blame, Show in
    folder, Copy file path, Edit file, Delete file.
14. **Enter in summary → focus description.**
15. **Description height persisted.**
16. **Amend toggle preserves prior message.** Checking amend pulls
    HEAD's summary/description and lets the user edit. Unchecking
    restores whatever the user had typed before.
17. **Commit area resizable.** Vertical drag between files list and
    commit form.
18. **Unstaged/Staged 50/50, collapsible.** Each section has a
    chevron. Collapsed → other gets all space.
19. **Sidebar starts under topbar.** Topbar spans full width;
    sidebar height matches the workspace below it.
20. **Resizable side panels.** Sidebar and right panel both have
    drag handles.

## Out of scope
- Real PTY (Windows ConPTY): the integrated terminal launches a
  shell with piped stdin/stdout. Good enough for non-interactive
  commands and basic git work; no curses apps. (Superseded 2026-10:
  the terminal is now a real PTY, see embedded-terminal.md.)
- File History / Blame as full features: menu wiring + IPC stub
  only; viewers come later.
- Redo across sessions: the redo stack is in-memory per session.

## Public contracts changed
- IPC: `file_read(path, file)`, `file_delete(path, file)`,
  `file_show_in_folder(path, file)`, `file_history(path, file)`,
  `repo_logs(path, limit)`, `terminal_spawn`, `terminal_write`,
  `terminal_kill` (with `terminal-output` event).
- Stores: new `stores/layout.ts` (sizes/zoom), `stores/terminal.ts`,
  `stores/logs.ts`, `stores/contextmenu.ts`, `stores/history.ts`
  (undo/redo). `centerMode` no longer holds `commit`; commit
  selection lives in `repo` store.

## Rejected alternatives
- **Embed xterm.js + ConPTY now.** Big lift for marginal v1 gain;
  defer behind same component contract.
- **Use `git stash show -p` for sidebar stash preview only.** Chose
  to surface the same right-panel commit-details layout for stash,
  for consistency with #4.
