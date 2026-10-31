# Conflict resolution (2026-10)

Neighbors: [repo-refresh.md](repo-refresh.md) (every action here runs
through `withBusy`, so the status and op state refresh afterwards),
[app-dialogs.md](app-dialogs.md) (the confirm before a whole-file take),
[undo-history.md](undo-history.md) (why conflict actions are not undoable).

## Purpose

A merge, rebase, cherry-pick or revert that stops on conflicts used to leave
the user with ordinary unstaged rows and no action on them. Resolving meant
leaving GitBee for an editor and running `git add` by hand. This feature lets
the user finish the operation inside the app:

- a whole-file choice from the Conflicts list, or
- a block-by-block resolution in the center pane.

## Public contract

### Backend (Tauri commands)

| Command | Arguments | Behaviour | Errors |
|---|---|---|---|
| `conflict_take_side` | `path, file, side` (`"ours"` or `"theirs"`) | Runs `git checkout --ours\|--theirs -- <file>`, then `git add -- <file>`. | Unknown side: message echoes the value. Git failure: `GitFailed`. |
| `file_write` | `path, file, content` | Writes UTF-8 to the worktree file. Used by the editor, then followed by `mark_resolved`. | Absolute path, `..`, missing parent, or a real location (symlinks resolved) outside the repo. |
| `mark_resolved` | `path, file` | `git add -- <file>` (existing command). The frontend refuses it while markers remain. | Git failure. |

`op_state` and `op_abort` are unchanged. `op_continue` passes `GIT_EDITOR=true`
for every op it continues (merge, rebase, cherry-pick, revert), so a message
editor cannot open in the hidden process and hang it. Git keeps the message it
prepared. See `interactive-rebase.md`.

### Frontend modules

- `src/lib/conflict/parse.ts`: `parseConflicts`, `resolveConflicts`,
  `linesForChoice`, `hasMarkers`, `looksBinary`. Types: `ConflictDoc`,
  `ConflictBlock`, `ConflictChoice`.
- `src/lib/conflict/choices.ts`: progress (`resolvedCount`, `allResolved`),
  Save gate (`canSave`), navigation (`stepConflict`,
  `pickNextConflictedPath`), `indexSegments`.
- `src/lib/conflict/labels.ts`: `activeOp`, `sideNames`, `takeLabel`.
- `src/lib/conflict/actions.ts`: `takeSide`, `markResolved`, `saveResolution`.
- Center mode `{ kind: "conflict", file }`, opened with `showConflict(file)`.
  `CenterPanel` renders `ConflictEditor`.

### Side names

Git's `ours` and `theirs` depend on the operation:

| Operation (first true flag, OpBanner order) | ours | theirs |
|---|---|---|
| rebase | Base (onto) | Your commit |
| merge, cherry-pick, revert | Mine | Theirs |

WHY: during a rebase git's "ours" is the branch being replayed onto, and
"theirs" is the user's own commit. Calling ours "Mine" would make the user
take the wrong side. Labels use the same precedence as the banner, so the
banner text and the side names never disagree.

### Conflicts list (staging panel)

Conflicted entries appear only in `ConflictList`, above the Unstaged and
Staged lists. They are excluded from both lists: a conflicted entry has index
`conflicted`, which `isStaged` would otherwise count as staged.

- Each row: name (opens the editor), the two side buttons, and "Resolve…".
- Side buttons take the whole file after a confirm, because the working-tree
  file, including hand edits, is replaced.
- Right-click: the same actions, plus "Mark resolved" and "Open in external
  editor" (existing `file_edit`).

### Conflict editor (center pane)

- Loads the file with `file_read`. A file containing a NUL byte is binary:
  the editor offers only whole-file Mine or Theirs.
- Each block shows both sides, highlighted. The base section (diff3/zdiff3)
  is collapsed and read-only.
- Buttons per block: Take mine, Take theirs, Take both, Take both (theirs
  first), Edit result. Edit result opens a textarea seeded with what the
  block shows now.
- Plain text between blocks shows three lines on each side of a gap. The
  rest folds behind a button.
- Header: "N of M conflicts resolved", Previous and Next (clamped, not
  wrapped), Cancel (writes nothing), and Save & mark resolved.
- Save writes the file with `file_write`, stages it with `mark_resolved`,
  then opens the next conflicted file or returns to the graph.

### Line endings

The file is split into lines and rebuilt with its dominant terminator, so a
CRLF file stays CRLF. A file that mixes endings comes back with one
terminator. That is the accepted trade-off of a line-based model.

### OpBanner

While any entry is conflicted, the banner shows "N conflicted files left" and
Continue is disabled. Its tooltip names the count. Abort is always enabled.

## Invariants

1. The editor writes a file only when every block has a choice and the
   rebuilt text has no start, base or end marker line. `canSave` gates the
   button and `saveResolution` checks again before writing.
2. "Mark resolved" in the menu reads the file first and refuses while markers
   remain. `git add` would stage them as content.
3. Side names come from `op_state`. A rebase never shows "Mine" for ours.
4. A conflicted entry appears in exactly one list: `ConflictList`.
5. `file_write` never writes outside the repo, including through a symlink
   that lives inside it.
6. An unterminated marker is never guessed at. The marker line stays as text,
   the parse reports `malformed`, and Save stays disabled until no marker
   remains.
7. A marker line is any line starting with `<<<<<<<`, `|||||||` or `>>>>>>>`.
   A bare `=======` is not counted, because Markdown uses it for headings.

## Out of scope

- A three-pane merge editor with base editing. The base is shown read-only.
- Binary conflicts beyond whole-file Mine or Theirs.
- Submodule conflicts. Their entries have no text, so the whole-file take
  may fail, and the error appears as a toast.
- Undo for conflict actions. The undo store restores file bytes only, not an
  unmerged index. The incoming side stays in the merge or pick commit, or in
  the rebase todo, so `git checkout <commit> -- <file>` brings it back.
- Delete-versus-modify conflicts beyond "Mark resolved". A missing file reads
  as empty, so marking it resolved stages the deletion.

## Rejected alternatives

- **Launching `git mergetool`.** It depends on the user's configured tool,
  can block on a GUI, and cannot show or keep the choices made in GitBee.
- **A Monaco three-way diff.** It adds a heavy bundle for one screen. The
  block model covers the need.
- **Regenerating markers with `git merge-file` or `git checkout -m` on each
  re-read.** This discards the user's partial choices every time the file is
  reloaded.
- **Taking a whole side without confirmation.** Rejected because hand edits in
  the file are lost. The confirm dialog is the only guard.
