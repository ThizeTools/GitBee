# Command palette (Ctrl+P)

Neighbors: [keyboard-and-toasts.md](keyboard-and-toasts.md) (the shortcut table
that lists Ctrl+P), [undo-history.md](undo-history.md) (the undo entries the
branch and checkout rows record), [theme-system.md](theme-system.md) (the theme
rows apply the same way the picker does).

## Purpose

1. The palette was a substring filter over a short hand-written command list.
   Branches, files, commits and themes had no route except their own panels.
2. GitKraken's "fuzzy finder" merges all of those into one list. One input,
   one ranking, typed initials that work ("co" finds "Checkout").
3. Prefix characters keep the finder usable when the user already knows which
   kind of row they want.

## Public contract

### Prefix modes

Typed into the empty box, the first character picks a mode. It moves into a
chip and does not stay in the text. Backspace on an empty box clears the chip.

| Prefix | Mode | Rows |
|---|---|---|
| (none) | All | Actions, repos, branches, files, themes; commits only for a sha-looking query |
| `>` | Actions | Action rows only |
| `@` | Branches | Checkout rows for local and remote-tracking branches |
| `#` | Commits | "Go to commit" for every loaded commit; a sha-looking text narrows to that sha prefix |
| `/` | Files | History and Blame for each changed file and each file of the selected commit |
| `:` | Themes | One row per built-in and custom theme |

A prefix character typed while a mode is already set is ordinary search text.

### Row categories

Action, Repo, Branch, File, Theme, Commit, LFS. The category is shown on the
right of each row. LFS rows appear only when git-lfs is installed and a repo is
open; see [git-lfs.md](git-lfs.md).

### Actions

Repo-bound actions appear only when a repo is open: Refresh repo, Fetch all
remotes, Pull, Pull (rebase), Push, Stash all changes, Pop stash (asks first),
New branch from HEAD, Add submodule.

Always present: Toggle light/dark, Undo and Redo (subtitle names the entry),
Zoom in, Zoom out, Reset zoom, Show or Hide sidebar, Show or Hide right panel,
Toggle dim merge commits, Show or Hide column for each optional graph column,
Open logs, Open shortcuts.

### Matching and ordering

- Case-insensitive subsequence match against the row **title** only. The
  subtitle is shown but not searched.
- Score: a match at a word start, after a separator or at a camel-case hump
  scores higher; consecutive characters score higher than scattered ones; a gap
  costs more than the characters after a match; an exact prefix gets a bonus,
  so "fetch" puts "Fetch all remotes" above "Show fetch".
- The alignment is the best one found by dynamic programming, not the first
  greedy one.
- Equal scores keep provider order, and the unprefixed finder lists actions
  first, so actions win ties.
- An empty text shows the most recently run rows first (up to 8, newest first),
  then the rest in provider order.

### Keys

| Keys | Action |
|---|---|
| ↑ / ↓ | Move the selection one row |
| PageUp / PageDown | Move the selection 8 rows |
| Enter | Run the selected row |
| Esc | Close the palette |
| Backspace on empty box | Clear the mode chip |
| Mouse hover | Select the row under the pointer |

### Limits

- At most 50 rows are rendered per search.
- Recently run ids are stored under `gkp.palette.recent.v1` in localStorage, up
  to 8. Storage failures are ignored.

## Invariants

- Running a row closes the palette before the row's action starts, so a dialog
  the action opens is never stacked under the finder.
- Never more than 50 DOM rows: the search result is capped before rendering.
- Repo-bound actions read the current repo when they run, not when the palette
  opened.
- Branch checkout and commit rows reuse the graph's checkout and scroll
  helpers, so checkout undo is recorded the same way as a branch menu checkout.
- Graph and message columns never get a show/hide row (they are locked in
  `graph/columns.ts`).
- File rows call `showFileHistory` and `showFileBlame` from `stores/center.ts`.

## Data sources

- Branches: the graph's local and remote-tracking refs. `origin/HEAD` is skipped.
- Repos: the Recents list.
- Files: the working-tree changes plus the files of the selected commit. No IPC
  lists every tracked file, so the "/" list does not include files that have not
  changed and are not in the selected commit. Adding a tracked-file listing
  would need a backend command.
- Commits: the visible graph nodes (stash helpers and filtered rows excluded).
- Themes: built-in and custom themes.

## Out of scope

- User-defined commands or aliases.
- A keybinding editor. The palette shows no shortcut column.
- Searching repo paths or commit authors. Titles are the only searched text.
- Tracked-file search across the whole repository (see Data sources).

## Rejected alternatives

- **fuse.js for matching.** It adds a dependency for what is a roughly 180-line
  scorer over short titles, and its scoring is harder to pin with tests. The
  scorer here is covered by ordering tests (`fuzzy.test.ts`).
- **Separate palettes per kind (one for branches, one for files, ...).**
  GitKraken merges them into one finder, and a user does not know in advance
  which kind a name belongs to. Prefixes give the narrowing without a second
  shortcut per kind.
- **Greedy subsequence matching.** It finds the first match, not the best one:
  "ab" in "xab ab" would score the mid-word "a". The dynamic-programming pass is
  the difference between that and the word-start match.

## Files

- `src/lib/palette/` pure modules: `fuzzy.ts` (matcher), `query.ts` (prefixes),
  `sources.ts` (store values to plain rows), `collect.ts` and `search.ts`
  (per-mode rows, ranking, cap), `recent.ts`, `highlight.ts`.
- `src/lib/palette/providers/` one module per kind. Each returns `PaletteItem`s
  whose `run` calls the existing store or menu helper.
- `src/lib/components/CommandPalette.svelte` and `components/palette/PaletteRow.svelte`.
