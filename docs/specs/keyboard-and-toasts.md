# Keyboard shortcuts and toasts (2026-10)

Neighbors: [app-dialogs.md](app-dialogs.md) (Esc and Ctrl+Enter in dialogs),
[graph-filters-per-repo.md](graph-filters-per-repo.md) (the hide/solo/pin
state that graph rows depend on).

## Purpose

1. The graph moved only by arrows. A long history had no way to jump to HEAD,
   to the upstream branch, or to page through rows.
2. Undo for commits was reachable only from a menu. Ctrl+Z did nothing, and
   the native text-field undo was the only one users knew.
3. The Shortcuts panel was a hand-kept six-line list. It missed most keys.
4. Toasts disappeared after 5 s even while the user was reading them, and the
   stack had no cap, so a burst of messages could bury the one error that
   mattered.

## Public contract

### Shortcut table

This table is the contract. It is also the data in `ShortcutsPanel.svelte`.
A change to any handler changes its row in the same PR.

**Tabs**

| Keys | Action |
|---|---|
| Ctrl+T | New tab page |
| Ctrl+W | Close current tab |
| Ctrl+Shift+T | Reopen last closed tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+1 … Ctrl+8 | Jump to tab N |
| Ctrl+9 | Jump to last tab |
| Middle-click tab | Close that tab |

**Panels**

| Keys | Action |
|---|---|
| Ctrl+P | Command palette |
| Ctrl+L | Logs panel |
| Ctrl+` | Open a terminal in the current repo |
| Ctrl+B | Toggle left sidebar |
| Ctrl+Alt+B | Toggle right panel |
| Ctrl+Alt+F | Focus the sidebar filter |
| Esc | Close the topmost menu, palette, dialog or search; from a diff or file view, back to the graph |
| Palette: ↑ / ↓, Enter | Move through commands, run the highlighted one |
| Ctrl+Enter | Submit the edit-message, set-upstream and new-worktree dialogs |
| Terminal: Enter, ↑ / ↓ | Run command; previous / next command from history |
| GitHub login: Enter | Submit the access token |
| Theme picker: Enter / Space | Apply theme (double-click a theme to edit it) |
| Hover a notice | Pause its auto-dismiss timer |

**Graph** (graph focus mode; see invariants)

| Keys | Action |
|---|---|
| ↑ / ↓ | Newer / older commit (graph focus); previous / next file (file focus) |
| → / ← | Open the commit's file list / back to the graph |
| Enter | Open the highlighted file (file focus) |
| h | Select the HEAD commit and scroll to it |
| Shift+H | Select the upstream commit, `origin/<branch>` first |
| Home / End | First / last visible commit |
| PageUp / PageDown | Move one page up / down |
| Double-click commit | Check out the branch at that commit |
| Double-click branch | Check out the branch (sidebar and ref badges) |

**Search**

| Keys | Action |
|---|---|
| Ctrl+F | Find a commit in the graph |
| Enter / F3 | Next match |
| Shift+Enter / Shift+F3 | Previous match |
| Esc | Close search |

**Commit**

| Keys | Action |
|---|---|
| Enter (summary) | Move to the description |
| Ctrl+Enter | Commit (from summary or description) |
| Ctrl+click / Shift+click file | Select several files, or a range, in the staging list |

**Zoom**

| Keys | Action |
|---|---|
| Ctrl+= / Ctrl++ | Zoom in |
| Ctrl+- | Zoom out |
| Ctrl+0 | Reset zoom |

**Undo**

| Keys | Action |
|---|---|
| Ctrl+Z | Undo last commit (outside text fields) |
| Ctrl+Shift+Z / Ctrl+Y | Redo |

### Modules

- `src/lib/stores/graphKeys.ts` (pure, no store or IPC imports):
  - `graphKeyAction(key, shift)` maps a key to `head`, `upstream` or a row move, or null.
  - `undoKeyAction(key, shift)` maps to `undo`, `redo` or null.
  - `nextRowIndex(kind, current, total, page)` returns the target row index, or -1 when there are no rows. `current` < 0 means nothing selected.
  - `pageRowCount(viewportPx, rowPx)` is `max(1, floor(0.6 * viewportPx / rowPx))`.
  - `upstreamSha(refs, headBranch)` returns the sha of `<remote>/<headBranch>`, `origin` first.
  - `isEditableTarget(target)` is true for input, textarea, select and contenteditable.
- `src/lib/stores/graphKeyActions.ts`: `runGraphKeyAction(action)` selects the row
  (`selectedSha`, `showCommit`, `graphScrollTarget`) and notifies when there is no
  row to select.
- `src/lib/stores/notifications.ts`:
  - `notify(...)` keeps at most `MAX_VISIBLE_TOASTS` (5).
  - `pauseNotice(id)` and `resumeNotice(id)` freeze and restart a toast's dismiss timer.
  - `dismiss(id)` and `dismissAll()` also clear the timers.
- `src/lib/stores/toastTimers.ts` (pure): `pickEvictedToast` and `remainingAfterRun`.

### Page size for PageUp / PageDown

The graph's scroll element is not exported, so the page size is estimated from
the window: `floor(0.6 * window.innerHeight / 28)`. The 28 px row height is
`ROW_HEIGHT` from `$lib/graph/layout`. The 60% factor leaves room for the top
bar, tab bar and status bar, and keeps some context rows on screen after a jump.
A window 800 px tall moves 17 rows per page.

### Feedback

| Situation | Result |
|---|---|
| `h` in a repo with no commits | Info toast "No HEAD commit" |
| `Shift+H` with no upstream ref in the loaded history | Info toast "No upstream commit" |
| `h` / `Shift+H` target hidden by the graph filter | Info toast "Commit not shown" |

## Invariants

- Graph keys (`h`, `Shift+H`, `Home`, `End`, `PageUp`, `PageDown`) and the
  arrow keys fire only in graph focus mode, with no Ctrl or Alt, and never when
  focus is in an input, textarea, select or contenteditable.
- The new graph keys (`h`, `Shift+H`, `Home`, `End`, `PageUp`, `PageDown`) also
  never fire while the command palette, the theme picker or a modal is open.
  The arrow keys do not have this guard yet.
- Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y never fire in a text field, so native text
  undo keeps working there.
- Ctrl/Meta combos for tabs, panels and zoom still fire everywhere, as before.
  They carry no text meaning, so they do not clash with editing. This is a
  deliberate exception to "shortcuts never fire in text inputs".
- Graph keys select only rows that are visible after the hide/solo filter.
  A target that has no row shows a toast, and nothing is selected silently.
- `Home`, `End`, `PageUp` and `PageDown` never land on the WIP row. Only `Up`
  from row 0 does, as before.
- At most five toasts are on screen. The evicted one is the oldest non-error
  toast. If every visible toast is an error, the oldest error goes.
- A hovered toast's dismiss time stops. Its progress bar stops at the same
  point (`animation-play-state: paused`), and leaving resumes both from the
  same remaining time.
- Every key handler in the app has a row in the table above. A handler without a
  row, or a row without a handler, is a spec bug.

## Out of scope

- User-remappable keys. The table is fixed.
- Keyboard pause for toasts. There is no focus target on a toast; hover is the
  only pause gesture.
- Exact graph viewport height for the page size. See the page-size section.
- Undo for anything other than commits. History is commit-only for now.
- Mac-specific key differences beyond the existing `ctrlKey || metaKey` check.

## Rejected alternatives

- **Per-component keydown listeners for graph keys.** They fire only when the
  graph has DOM focus. After a click in the sidebar, focus is elsewhere, and the
  keys would do nothing. One window handler that reads the nav store works from
  any focus that is not a text field.
- **Measuring the graph scroll element for the page size.** It would need
  `GraphCanvas` to export its viewport height, and that couples two modules
  for a few rows of accuracy. The window-height estimate is good enough.
- **Evicting the oldest toast of any kind.** A failure message is the one thing
  the user must still read when the next message arrives. Info and success
  toasts go first.
- **A `requestAnimationFrame` loop for the progress bar.** Rejected earlier
  (see `Toaster.svelte`): it re-rendered every frame with no toasts on screen.
  The CSS animation with a play-state toggle does the same job with no per-frame
  work.
- **Global filters for every repo.** A branch hidden in repo A also hid it in
  repo B. That was the user complaint behind
  [graph-filters-per-repo.md](graph-filters-per-repo.md).
